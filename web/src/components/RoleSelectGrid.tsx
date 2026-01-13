
import { useRouter } from "next/router";

export default function RoleSelectGrid() {
  const router = useRouter();

  const goLogin = (role: string) => {
    localStorage.setItem("role", role);
    router.push("/login");
  };

  return (
    <section className="audience-grid">
      <div className="audience-card">
        <div className="audience-icon">👥</div>
        <h2>The Public</h2>
        <button
          className="audience-card__action"
          onClick={() => goLogin("public")}
        >
          Sign in
        </button>
      </div>

      <div className="audience-card">
        <div className="audience-icon">🏢</div>
        <h2>Business Owners</h2>
        <button
          className="audience-card__action"
          onClick={() => goLogin("business")}
        >
          Sign in
        </button>
      </div>

      <div className="audience-card">
        <div className="audience-icon">📐</div>
        <h2>Planners</h2>
        <button
          className="audience-card__action"
          onClick={() => goLogin("planner")}
        >
          Sign in
        </button>
      </div>

      <div className="audience-card">
        <div className="audience-icon">🏛️</div>
        <h2>Government</h2>
        <button
          className="audience-card__action"
          onClick={() => goLogin("government")}
        >
          Sign in
        </button>
      </div>
    </section>
  );
}