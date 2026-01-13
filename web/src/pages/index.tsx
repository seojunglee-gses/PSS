import Layout from "../components/Layout";
import RoleSelectGrid from "../components/RoleSelectGrid";

export default function HomePage() {
  return (
    <Layout>
      <section className="home-landing">
        <div className="home-landing__hero">
          <span className="home-landing__eyebrow">
            Participatory Planning
          </span>
          <h1>Select Your Role</h1>
          <p>
            Choose your role to join the planning process.
          </p>
        </div>

        <RoleSelectGrid />
      </section>
    </Layout>
  );
}