import Link from "next/link";
import { useRouter } from "next/router";

export default function Sidebar() {
  const router = useRouter();

  const isActive = (path: string) =>
    router.pathname === path ? "active" : "";

  return (
    <nav className="sidebar">
      <h1 className="logo">Participatory Planning</h1>

      <ul>
        <li className={isActive("/")}>
          <Link href="/">Home</Link>
        </li>
        <li className={isActive("/workspace")}>
          <Link href="/workspace">Workspace</Link>
        </li>
        <li className={isActive("Report")}>
          <Link href="/report">Report</Link>
        </li>
        <li className={isActive("/settings")}>
          <Link href="/settings">Settings</Link>
        </li>
        
      </ul>
    </nav>
  );
}
