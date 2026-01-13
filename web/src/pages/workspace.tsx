import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Layout from "../components/Layout";

export default function WorkspacePage() {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem("workspaceCode");
    if (!saved) {
      router.push("/");
    } else {
      setCode(saved);
    }
  }, [router]);

  if (!code) return null;

  return (
    <Layout>
      <section className="workspace">
        <h2>Workspace: {code}</h2>

        <div className="stages">
          <button>Problem</button>
          <button>Analysis</button>
          <button>Design</button>
          <button>Evaluation</button>
        </div>

        <div className="chat-area">
          <p>Chat UI will be here</p>
        </div>
      </section>
    </Layout>
  );
}
