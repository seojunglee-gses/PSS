import { useState } from "react";
import { useRouter } from "next/router";
import { auth } from "@/lib/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
} from "firebase/auth";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const router = useRouter();

  const submit = async () => {
    if (isSignup) {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    router.push("/select-role");
  };

  return (
    <div style={{ padding: 40 }}>
      <h1>{isSignup ? "Sign Up" : "Login"}</h1>
      <input value={email} onChange={(e) => setEmail(e.target.value)} />
      <br />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <br />
      <button onClick={submit}>Submit</button>
      <p onClick={() => setIsSignup(!isSignup)} style={{ cursor: "pointer" }}>
        {isSignup ? "Login instead" : "Create account"}
      </p>
    </div>
  );
}
