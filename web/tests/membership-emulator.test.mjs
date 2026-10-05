import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { Firestore } from "firebase-admin/firestore";
const require = createRequire(import.meta.url);
const build = process.env.PSS_MEMBERSHIP_BUILD;
const { enterProject, listProjects, mutateProject } = require(
  `${build}/lib/membership/server.js`,
);
const adminModule = require(`${build}/lib/firebaseAdmin.js`);
const enterHandler = require(`${build}/pages/api/projects/enter.js`).default;
const listingHandler = require(`${build}/pages/api/projects/index.js`).default;
const projectId = "demo-pss-membership";
assert.ok(
  process.env.FIRESTORE_EMULATOR_HOST,
  "Use the local emulator, never production.",
);
const db = new Firestore({ projectId });
const user = { uid: "participant-a", email: "person@example.com" };
const other = { uid: "participant-b", email: "other@example.com" };
const manager = { uid: "manager", email: "owner@example.com" };
const admin = { uid: "system", email: "adm@snu.ac.kr" };
const workspace = {
  problem: {
    title: "Saved project",
    text: "Existing definition",
    imageUrl: "",
  },
  data: { title: "Analysis", text: "Existing notes", imageUrl: "", cases: [] },
  alternatives: { text: "", imageUrl: "" },
  evaluation: { text: "", imageUrl: "" },
  report: { text: "", imageUrl: "" },
};
const project = (id, code) => ({
  projectId: id,
  projectName: `Project ${id}`,
  projectAdmin: manager.email,
  accessCode: code,
  createdAt: "2026-10-01T00:00:00Z",
  lastModifiedAt: "2026-10-01T00:00:00Z",
  workspaceContent: workspace,
});
let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(
        new URL("../firestore.rules", import.meta.url),
        "utf8",
      ),
    },
  });
});
after(async () => {
  await env?.cleanup();
  await db.terminate();
});
beforeEach(async () => {
  await env.clearFirestore();
  await db.doc("ppssProjects/p1").set(project("p1", "1111"));
  await db.doc("ppssProjects/p2").set(project("p2", "2222"));
});
const rejectedStatus = async (p, status) =>
  assert.rejects(p, (e) => e.status === status);
async function route(handler, body, token = "valid", method = "POST") {
  const original = adminModule.verifyUserRequest;
  const originalDb = adminModule.adminDb;
  adminModule.verifyUserRequest = async (t) => {
    if (t !== "valid") throw Error("bad token");
    return user;
  };
  adminModule.adminDb = () => db;
  const result = {};
  const res = {
    setHeader() {},
    status(code) {
      result.status = code;
      return this;
    },
    json(data) {
      result.body = data;
      return this;
    },
  };
  try {
    await handler(
      {
        method,
        body,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      },
      res,
    );
    return result;
  } finally {
    adminModule.verifyUserRequest = original;
    adminModule.adminDb = originalDb;
  }
}
test("first verified entry persists participant membership and last project without the code", async () => {
  const before = (await db.doc("ppssProjects/p1").get()).data();
  await enterProject(db, user, "p1", "1111");
  const member = (
    await db.doc("users/participant-a/projectMemberships/p1").get()
  ).data();
  assert.equal(member.role, "participant");
  assert.equal(member.projectId, "p1");
  assert.ok(member.joinedAt);
  assert.deepEqual(Object.keys(member).sort(), [
    "joinedAt",
    "projectId",
    "role",
  ]);
  assert.ok(!JSON.stringify(member).includes("1111"));
  assert.equal(
    (await db.doc("users/participant-a").get()).data().lastProjectId,
    "p1",
  );
  assert.deepEqual((await db.doc("ppssProjects/p1").get()).data(), before);
});
test("a returning user on another client can enter without a code; repeated entry preserves joinedAt", async () => {
  await enterProject(db, user, "p1", "1111");
  const joined = (
    await db.doc("users/participant-a/projectMemberships/p1").get()
  ).data().joinedAt;
  await enterProject(db, { ...user }, "p1");
  assert.ok(
    (await db.doc("users/participant-a/projectMemberships/p1").get())
      .data()
      .joinedAt.isEqual(joined),
  );
  const fresh = env
    .authenticatedContext(user.uid, { email: user.email })
    .firestore();
  await assertSucceeds(
    getDoc(doc(fresh, "users/participant-a/projectMemberships/p1")),
  );
});
test("multiple joined projects and last project come from Firebase; unjoined projects hide codes/content", async () => {
  await enterProject(db, user, "p1", "1111");
  let listing = await listProjects(db, user);
  assert.deepEqual(listing.joinedIds, ["p1"]);
  assert.equal(listing.lastProjectId, "p1");
  assert.equal(
    listing.projects.find((p) => p.projectId === "p2").accessCode,
    undefined,
  );
  assert.equal(
    listing.projects.find((p) => p.projectId === "p2").workspaceContent.data,
    undefined,
  );
  await enterProject(db, user, "p2", "2222");
  listing = await listProjects(db, user);
  assert.deepEqual(listing.joinedIds.sort(), ["p1", "p2"]);
  assert.equal(listing.lastProjectId, "p2");
  assert.equal(
    listing.projects.find((p) => p.projectId === "p1").workspaceContent.problem
      .text,
    "Existing definition",
  );
  assert.equal(
    listing.projects.find((p) => p.projectId === "p1").accessCode,
    undefined,
  );
});
test("invalid codes and arbitrary project IDs never grant membership", async () => {
  await rejectedStatus(enterProject(db, user, "p1", "9999"), 400);
  await rejectedStatus(enterProject(db, user, "p2"), 403);
  await rejectedStatus(enterProject(db, user, "missing", "1111"), 404);
  assert.equal(
    (await db.doc("users/participant-a/projectMemberships/p1").get()).exists,
    false,
  );
  assert.equal(
    (await db.doc("users/participant-a/projectMemberships/p2").get()).exists,
    false,
  );
});
test("revocation blocks both cached/direct entry and invitation-code replay; deleted membership needs verification again", async () => {
  await enterProject(db, user, "p1", "1111");
  await db
    .doc("users/participant-a/projectMemberships/p1")
    .update({ revoked: true });
  await rejectedStatus(enterProject(db, user, "p1"), 403);
  await rejectedStatus(enterProject(db, user, "p1", "1111"), 403);
  assert.deepEqual((await listProjects(db, user)).joinedIds, []);
  assert.equal((await listProjects(db, user)).lastProjectId, null);
  await db.doc("users/participant-a/projectMemberships/p1").delete();
  await rejectedStatus(enterProject(db, user, "p1"), 403);
});
test("rules allow own membership reads and deny client membership creation, edits, role escalation and project-code access", async () => {
  await enterProject(db, user, "p1", "1111");
  const client = env
    .authenticatedContext(user.uid, { email: user.email })
    .firestore();
  await assertSucceeds(
    getDoc(doc(client, "users/participant-a/projectMemberships/p1")),
  );
  await assertFails(
    getDoc(doc(client, "users/participant-b/projectMemberships/p1")),
  );
  await assertFails(
    setDoc(doc(client, "users/participant-a/projectMemberships/p2"), {
      projectId: "p2",
      role: "participant",
    }),
  );
  await assertFails(
    setDoc(
      doc(client, "users/participant-a/projectMemberships/p1"),
      { role: "admin" },
      { merge: true },
    ),
  );
  await assertFails(
    deleteDoc(doc(client, "users/participant-a/projectMemberships/p1")),
  );
  await assertFails(
    setDoc(
      doc(client, "users/participant-a"),
      { lastProjectId: "p2" },
      { merge: true },
    ),
  );
  await assertFails(getDoc(doc(client, "ppssProjects/p1")));
  await assertFails(getDocs(collection(client, "ppssProjects")));
  await assertFails(
    setDoc(
      doc(client, "ppssProjects/p1"),
      { accessCode: "9999", projectAdmin: user.email },
      { merge: true },
    ),
  );
});
test("rules protect project-scoped chat data from unjoined/revoked users and other UIDs", async () => {
  const client = env
    .authenticatedContext(user.uid, { email: user.email })
    .firestore();
  const chat = doc(client, "users_p1/participant-a/steps/data");
  await assertFails(setDoc(chat, { logs: [] }));
  await enterProject(db, user, "p1", "1111");
  await assertSucceeds(setDoc(chat, { logs: [] }));
  await assertSucceeds(getDoc(chat));
  await assertFails(
    setDoc(doc(client, "users_p2/participant-a/steps/data"), { logs: [] }),
  );
  await assertFails(getDoc(doc(client, "users_p1/participant-b/steps/data")));
  await db
    .doc("users/participant-a/projectMemberships/p1")
    .update({ revoked: true });
  await assertFails(getDoc(chat));
});
test("roles are preserved: managers open their own projects; participants cannot edit codes or administrators", async () => {
  await enterProject(db, manager, "p1");
  assert.equal(
    (await listProjects(db, manager)).projects[0].accessCode,
    "1111",
  );
  await enterProject(db, user, "p1", "1111");
  await rejectedStatus(
    mutateProject(db, user, {
      action: "update",
      projectId: "p1",
      project: { accessCode: "9999", projectAdmin: user.email },
    }),
    403,
  );
  await rejectedStatus(
    mutateProject(db, user, {
      action: "create",
      projectId: "p3",
      project: project("p3", "3333"),
    }),
    403,
  );
  await mutateProject(db, admin, {
    action: "create",
    projectId: "p3",
    project: project("p3", "3333"),
  });
  assert.ok((await db.doc("ppssProjects/p3").get()).exists);
});
test("deleted projects are removed from memberships/navigation and cannot be opened", async () => {
  await enterProject(db, user, "p1", "1111");
  await db.doc("ppssProjects/p1").delete();
  await rejectedStatus(enterProject(db, user, "p1"), 404);
  assert.deepEqual((await listProjects(db, user)).joinedIds, []);
});
test("failed attempts are throttled per Firebase user across projects without saving codes", async () => {
  for (let i = 0; i < 10; i++)
    await rejectedStatus(
      enterProject(db, user, i % 2 ? "p1" : "p2", "9999"),
      400,
    );
  await rejectedStatus(enterProject(db, user, "p1", "1111"), 429);
  const profile = (await db.doc("users/participant-a").get()).data();
  assert.ok(!JSON.stringify(profile).includes("9999"));
  await enterProject(db, other, "p1", "1111");
});
test("API authenticates before any entry and rejects invalid input before granting access", async () => {
  assert.equal(
    (await route(enterHandler, { projectId: "p1", code: "1111" }, null)).status,
    401,
  );
  assert.equal(
    (await route(enterHandler, { projectId: "p1", code: "1111" }, "bad"))
      .status,
    401,
  );
  assert.equal(
    (await route(enterHandler, { projectId: "../p1", code: "1111" })).status,
    400,
  );
  assert.equal(
    (await route(enterHandler, { projectId: "p1", code: "9999" })).status,
    400,
  );
  assert.equal(
    (await route(enterHandler, { projectId: "p1", code: "1111" })).status,
    200,
  );
  assert.equal((await route(enterHandler, { projectId: "p1" })).status, 200);
  const listing = await route(listingHandler, undefined, "valid", "GET");
  assert.equal(listing.status, 200);
  assert.deepEqual(listing.body.joinedIds, ["p1"]);
});

test("opening an existing membership cannot reset failed attempts for another invitation", async () => {
  await enterProject(db, user, "p1", "1111");
  for (let i = 0; i < 10; i++)
    await rejectedStatus(enterProject(db, user, "p2", "9999"), 400);
  await enterProject(db, user, "p1");
  await rejectedStatus(enterProject(db, user, "p2", "2222"), 429);
});
test("participant cannot edit administrative project resources or another participant summary", async () => {
  await enterProject(db, user, "p1", "1111");
  const client = env
    .authenticatedContext(user.uid, { email: user.email })
    .firestore();
  await assertFails(
    setDoc(doc(client, "ppssStageLocks_p1/current"), {
      stages: { data: true },
    }),
  );
  await assertFails(
    setDoc(doc(client, "ppssWorkspaceSummaries_p1/participant-b"), {
      summary: "altered",
    }),
  );
  await assertSucceeds(
    setDoc(doc(client, "ppssWorkspaceSummaries_p1/participant-a"), {
      summary: "own summary",
    }),
  );
  const owner = env
    .authenticatedContext(manager.uid, { email: manager.email })
    .firestore();
  await assertSucceeds(
    setDoc(doc(owner, "ppssStageLocks_p1/current"), { stages: { data: true } }),
  );
});

test('project-owner editing preserves other stages and cases in the existing project document',async()=>{
  const problem={...workspace.problem,title:'Updated definition'};
  await mutateProject(db,manager,{action:'update',projectId:'p1',project:{workspaceContent:{problem}}});
  const saved=(await db.doc('ppssProjects/p1').get()).data();
  assert.deepEqual(saved.workspaceContent.problem,problem);assert.deepEqual(saved.workspaceContent.data,workspace.data);
  assert.deepEqual(saved.workspaceContent.evaluation,workspace.evaluation);assert.equal(saved.accessCode,'1111');
});
