import React, { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { verifyEmailApi } from "../api/auth.api";
import { useAuth } from "../context/AuthContext";
import { AuthCard } from "../components/AuthCard";

export const VerifyEmailPage: React.FC = () => {
  const [params] = useSearchParams();
  const { user, refreshUser } = useAuth();
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [message, setMessage] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // tokens are single-use; don't double-submit in StrictMode
    ran.current = true;
    const token = params.get("token");
    if (!token) {
      setState("error");
      setMessage("This verification link is missing its token.");
      return;
    }
    verifyEmailApi(token)
      .then((res) => {
        setState("ok");
        setMessage(res.message);
        if (user) refreshUser();
      })
      .catch((err) => {
        setState("error");
        setMessage(err.message);
      });
  }, []);

  return (
    <AuthCard title="Email verification">
      <div className="text-center space-y-4">
        {state === "loading" && <Loader2 className="mx-auto animate-spin text-blue-600" size={48} />}
        {state === "ok" && <CheckCircle2 className="mx-auto text-green-600" size={48} />}
        {state === "error" && <XCircle className="mx-auto text-red-500" size={48} />}
        <p className="text-gray-700">{state === "loading" ? "Verifying..." : message}</p>
        {state !== "loading" && (
          <Link to={user ? "/account" : "/login"} className="inline-block text-blue-600 font-semibold hover:underline">
            {user ? "Go to my account" : "Go to login"}
          </Link>
        )}
      </div>
    </AuthCard>
  );
};
