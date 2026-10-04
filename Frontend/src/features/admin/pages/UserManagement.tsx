import React, { useEffect, useState, useMemo } from "react";
import { adminService } from "../api/admin.service";
import { useAuth } from "../../auth/context/AuthContext";
import { toast } from "sonner";
import { Search, Trash2, UserCog } from "lucide-react";
export const UserManagement = () => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const fetchUsers = async () => {
    try {
      const data = await adminService.getUsers();
      setUsers(data);
    } catch (err) {
      toast.error("Failed to load users");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    fetchUsers();
  }, []);
  const filteredUsers = useMemo(() => {
    return users.filter((u) =>
      u.email.toLowerCase().includes(searchTerm.toLowerCase()),
    );
  }, [users, searchTerm]);
  const handleRoleChange = async (
    userId: string,
    newRole: "ADMIN" | "USER",
  ) => {
    try {
      await adminService.updateRole(userId, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)),
      );
      toast.success(`Role updated to ${newRole}`);
    } catch (err) {
      toast.error("Failed to update role");
    }
  };
  const handleDelete = async (id: string) => {
    if (id === currentUser?.id) {
      return toast.error("You cannot delete your own admin account!");
    }
    if (!window.confirm("Are you sure you want to delete this user?")) return;
    try {
      await adminService.deleteUser(id);
      setUsers(users.filter((u) => u.id !== id));
      toast.success("User removed successfully");
    } catch (err) {
      toast.error("Delete failed");
    }
  };
  if (loading)
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              User Management
            </h1>
            <p className="text-gray-500">
              Manage permissions and account status
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Search by email..."
              className="pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full md:w-80"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="p-4 font-semibold text-gray-600">
                  User Details
                </th>
                <th className="p-4 font-semibold text-gray-600">Role</th>
                <th className="p-4 font-semibold text-gray-600">Joined Date</th>
                <th className="p-4 font-semibold text-gray-600 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length > 0 ? (
                filteredUsers.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors"
                  >
                    <td className="p-4">
                      <div className="font-medium text-gray-900">{u.email}</div>
                      <div className="text-xs text-gray-400 font-mono">
                        ID: {u.id}
                      </div>
                    </td>
                    <td className="p-4">
                      <select
                        value={u.role}
                        disabled={u.id === currentUser?.id}
                        onChange={(e) =>
                          handleRoleChange(u.id, e.target.value as any)
                        }
                        className={`text-xs font-bold px-3 py-1.5 rounded-full border-none cursor-pointer focus:ring-2 focus:ring-offset-1
                          ${
                            u.role === "ADMIN"
                              ? "bg-purple-100 text-purple-700 focus:ring-purple-400"
                              : "bg-blue-100 text-blue-700 focus:ring-blue-400"
                          } ${u.id === currentUser?.id ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <option value="USER">USER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                    </td>
                    <td className="p-4 text-sm text-gray-500">
                      {u.created_at
                        ? new Date(u.created_at).toLocaleDateString(undefined, {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })
                        : "N/A"}
                    </td>
                    <td className="p-4 text-right">
                      <button
                        onClick={() => handleDelete(u.id)}
                        disabled={u.id === currentUser?.id}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
                          ${
                            u.id === currentUser?.id
                              ? "text-gray-300 cursor-not-allowed"
                              : "text-red-600 hover:bg-red-50 hover:text-red-700"
                          }`}
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-gray-500">
                    No users found matching your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
