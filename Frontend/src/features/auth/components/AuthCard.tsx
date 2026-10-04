import React from "react";

// Shared centered card used by the login / password / invitation pages.
export const AuthCard: React.FC<{
  title: string;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}> = ({ title, subtitle, children }) => (
  <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
    <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-2">{title}</h2>
        {subtitle && <p className="text-gray-600">{subtitle}</p>}
      </div>
      {children}
    </div>
  </div>
);

export const inputClass =
  "w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900";
export const primaryButtonClass =
  "w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 transition-colors";
