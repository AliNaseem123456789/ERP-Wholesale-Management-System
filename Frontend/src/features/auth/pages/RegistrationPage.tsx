import { AuthShell, inputClass, primaryButtonClass } from "../components/AuthCard";
import React, { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

export const RegistrationPage: React.FC = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    businessName: "",
  });
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    if (formData.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setIsLoading(true);
    try {
      await register(formData);

      toast.success("Account created! Check your email to verify your address.");
      navigate("/");
    } catch (err: any) {
      toast.error(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthShell title="Open a trade account" subtitle="Free for buyers. We review new accounts within one business day." wide>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <input
              name="firstName"
              placeholder="First name" aria-label="First name"
              value={formData.firstName}
              onChange={handleChange}
              className={inputClass}
            />
            <input
              name="lastName"
              placeholder="Last name" aria-label="Last name"
              value={formData.lastName}
              onChange={handleChange}
              className={inputClass}
            />
          </div>
          <input
            name="businessName"
            placeholder="Business / shop name" aria-label="Business / shop name"
            value={formData.businessName}
            onChange={handleChange}
            className={inputClass}
          />
          <input
            type="email"
            name="email"
            placeholder="Email" aria-label="Email"
            required
            value={formData.email}
            onChange={handleChange}
            className={inputClass}
          />

          <input
            type="password"
            name="password"
            placeholder="Password" aria-label="Password"
            required
            value={formData.password}
            onChange={handleChange}
            className={inputClass}
          />

          <input
            type="password"
            placeholder="Confirm password" aria-label="Confirm password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className={inputClass}
          />

          <button
            type="submit"
            disabled={isLoading}
            className={primaryButtonClass}
          >
            {isLoading ? "Creating your account…" : "Create account"}
          </button>
        </form>

        <p className="text-sm mt-8 pt-6 border-t border-line text-ink-2">
          Already have an account?{" "}
          <button
            onClick={() => navigate("/login")}
            className="text-brand-text font-semibold hover:underline"
          >
            Sign in
          </button>
        </p>
    </AuthShell>
  );
};
