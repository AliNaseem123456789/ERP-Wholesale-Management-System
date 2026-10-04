import React, { useState } from "react";
import { UserPlus, Loader2, ToggleLeft, ToggleRight, X } from "lucide-react";
import { useTeam } from "../../hooks/useTeam";
import { AddMemberForm } from "../AddMemberForm";

export const TeamTab = () => {
  const { team, loading, toggleAccess, refresh } = useTeam();
  const [view, setView] = useState<"list" | "add">("list");
  if (loading)
    return (
      <div className="p-20 text-center">
        <Loader2 className="animate-spin mx-auto text-blue-600" />
      </div>
    );
  if (view === "add") {
    return (
      <AddMemberForm
        onBack={() => setView("list")}
        onSuccess={() => {
          refresh();
          setView("list");
        }}
      />
    );
  }
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <header className="flex justify-between items-center bg-white p-6 rounded-[24px] border border-gray-100 shadow-sm">
        <div>
          <h2 className="text-xl font-black text-gray-900">Team Management</h2>
          <p className="text-sm text-gray-500">
            Manage staff access and ordering permissions
          </p>
        </div>
        <button
          onClick={() => setView("add")}
          className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
        >
          <UserPlus size={18} /> Add Staff Member
        </button>
      </header>
      <div className="bg-white border border-gray-100 rounded-[32px] overflow-hidden shadow-sm">
        <table className="w-full text-left">
          <thead className="bg-gray-50/50 border-b border-gray-50">
            <tr>
              <th className="px-8 py-5 text-[10px] font-black uppercase text-gray-400 tracking-widest">
                Team Member
              </th>
              <th className="px-8 py-5 text-[10px] font-black uppercase text-gray-400 text-center tracking-widest">
                Ordering Access
              </th>
              <th className="px-8 py-5 text-[10px] font-black uppercase text-gray-400 text-right tracking-widest">
                Joined Date
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {team.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-8 py-16 text-center text-gray-400 font-medium"
                >
                  No sub-accounts found. Click "Add Staff" to begin.
                </td>
              </tr>
            ) : (
              team.map((member) => (
                <tr
                  key={member.id}
                  className="hover:bg-blue-50/20 transition-colors group"
                >
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold border-2 border-white group-hover:border-blue-200 transition-all">
                        {member.users.first_name[0]}
                        {member.users.last_name[0]}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 leading-tight">
                          {member.users.first_name} {member.users.last_name}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {member.users.email}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-5 text-center">
                    <button
                      onClick={() =>
                        toggleAccess(
                          member.id,
                          member.permissions.can_place_order,
                        )
                      }
                      className={`p-1 rounded-full transition-all active:scale-90 ${member.permissions.can_place_order ? "text-green-500" : "text-gray-300"}`}
                    >
                      {member.permissions.can_place_order ? (
                        <ToggleRight size={32} />
                      ) : (
                        <ToggleLeft size={32} />
                      )}
                    </button>
                  </td>
                  <td className="px-8 py-5 text-right text-sm text-gray-500 font-medium">
                    {new Date(member.users.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
