"use client";

interface RoleCardProps {
  title: string;
  icon: string;
  onClick: () => void;
}

export default function RoleCard({ title, icon, onClick }: RoleCardProps) {
  return (
    <div className="role-card">
      <div className="role-icon">{icon}</div>
      <h3>{title}</h3>
      <button onClick={onClick}>SIGN IN</button>
    </div>
  );
}
