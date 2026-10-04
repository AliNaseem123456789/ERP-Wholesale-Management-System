import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../auth/context/AuthContext";

export const AdminRoute = () => {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;

  return user?.role === "ADMIN" ? <Outlet /> : <Navigate to="/" replace />;
};
