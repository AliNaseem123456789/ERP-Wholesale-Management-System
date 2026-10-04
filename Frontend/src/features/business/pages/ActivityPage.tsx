import React, { useEffect, useState } from "react";
import { History } from "lucide-react";
import { toast } from "sonner";
import { useBusiness } from "../context/BusinessContext";
import { businessApi, errorMessage } from "../api/business.api";
import { Card, PageHeader, Spinner, EmptyState, Pagination, dateTime } from "../components/ui";

const LABELS: Record<string, string> = {
  "company.register": "Registered the business",
  "company.update": "Updated business settings",
  "company.logo": "Changed the logo",
  "product.create": "Created a product",
  "product.update": "Updated a product",
  "product.delete": "Deleted a product",
  "product.deactivate": "Hid a product",
  "product.image": "Uploaded a product image",
  "brand.create": "Added a brand",
  "member.invite": "Invited a team member",
  "member.invite_revoke": "Revoked an invitation",
  "member.join": "Joined the team",
  "member.update": "Changed a team member",
  "member.remove": "Removed a team member",
  "order.status": "Changed an order status",
  "order.update": "Updated order details",
};

const summary = (row: any) => {
  const c = row.changes || {};
  if (row.action === "order.status") return `${c.from} → ${c.to}`;
  if (row.action === "member.invite") return `${c.email} as ${c.role}`;
  if (row.action === "product.create" || row.action === "product.update") return c.title || Object.keys(c).join(", ");
  if (row.action.startsWith("admin.")) return "by platform admin";
  return "";
};

export const ActivityPage: React.FC = () => {
  const { companyId } = useBusiness();
  const [page, setPage] = useState(1);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    businessApi.audit(companyId!, page).then(setData).catch((e) => toast.error(errorMessage(e)));
  }, [companyId, page]);

  return (
    <div>
      <PageHeader title="Activity log" subtitle="Who changed what, and when" />
      <Card>
        {!data ? (
          <Spinner />
        ) : data.data.length === 0 ? (
          <EmptyState icon={<History size={40} />} title="No activity yet" />
        ) : (
          <>
            <ul className="divide-y divide-gray-100 text-sm">
              {data.data.map((row: any) => (
                <li key={row.id} className="px-5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-gray-400 w-40 shrink-0">{dateTime(row.created_at)}</span>
                  <span className="font-semibold text-gray-900">{row.user?.email || "System"}</span>
                  <span className="text-gray-700">{LABELS[row.action] || row.action}</span>
                  {row.entity_id && <span className="text-gray-400">#{row.entity_id}</span>}
                  <span className="text-gray-500 truncate">{summary(row)}</span>
                </li>
              ))}
            </ul>
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
};
