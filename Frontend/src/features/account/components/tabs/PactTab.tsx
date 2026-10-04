import React, { useState } from "react";
import { ShieldCheck, FileText, Info, Send, Phone, Mail } from "lucide-react";
const PactCompliance: React.FC = () => {
  const [formData, setFormData] = useState({
    email: "",
    ownerFirstName: "",
    ownerLastName: "",
    businessName: "",
    licenseNumber: "",
    state: "",
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("PACT Form Submitted (Dummy):", formData);
    alert("Form submitted! This is currently a dummy action.");
  };
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-gray-100 mb-8">
          <div className="flex items-center gap-3 mb-6 text-blue-600">
            <ShieldCheck size={32} strokeWidth={2.5} />
            <h1 className="text-3xl font-black uppercase tracking-tight text-gray-900">
              PACT ACT
            </h1>
          </div>
          <div className="prose prose-blue text-gray-600 space-y-4 leading-relaxed">
            <p className="font-bold text-gray-800">
              To ensure compliance with the ongoing PACT Act, all current and
              prospective customers are required to submit their business
              information.
            </p>
            <p>
              In addition, all accounts
              <span className="text-red-600 font-bold underline">MUST</span>
              fill out our PACT Act form and send in the necessary documents to
              continue receiving orders from RZ Smoke. Any business document
              that is required in your state MUST be submitted (Tobacco License,
              Business License, OTP License, Sales & Use Tax Permit, Seller's
              Permit).
            </p>

            <div className="bg-blue-50 border-l-4 border-blue-500 p-6 rounded-r-2xl flex gap-4 mt-8">
              <Info className="text-blue-500 shrink-0" size={24} />
              <div>
                <p className="text-sm font-medium text-blue-900">
                  Need Assistance?
                </p>
                <p className="text-sm text-blue-700 mt-1">
                  We are available Monday - Friday from 8AM - 7PM EST.
                </p>
                <div className="flex flex-wrap gap-4 mt-3">
                  <a
                    href="tel:5164884645"
                    className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-800 hover:text-blue-600"
                  >
                    <Phone size={14} /> 516-488-4645
                  </a>
                  <a
                    href="mailto:support@rzsmoke.com"
                    className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-blue-800 hover:text-blue-600"
                  >
                    <Mail size={14} /> support@rzsmoke.com
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-[32px] p-8 md:p-12 shadow-sm border border-gray-100">
          <div className="flex items-center gap-2 mb-8">
            <FileText className="text-gray-400" size={20} />
            <h2 className="text-lg font-black uppercase tracking-widest text-gray-400">
              Compliance Form
            </h2>
          </div>
          <form
            onSubmit={handleSubmit}
            className="grid grid-cols-1 md:grid-cols-2 gap-6"
          >
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Email Address *
              </label>
              <input
                type="email"
                required
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                placeholder="email@example.com"
                value={formData.email}
                onChange={(e) =>
                  setFormData({ ...formData, email: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Owner Legal First Name *
              </label>
              <input
                type="text"
                required
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                value={formData.ownerFirstName}
                onChange={(e) =>
                  setFormData({ ...formData, ownerFirstName: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Owner Legal Last Name *
              </label>
              <input
                type="text"
                required
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                value={formData.ownerLastName}
                onChange={(e) =>
                  setFormData({ ...formData, ownerLastName: e.target.value })
                }
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Legal Business Name *
              </label>
              <input
                type="text"
                required
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                value={formData.businessName}
                onChange={(e) =>
                  setFormData({ ...formData, businessName: e.target.value })
                }
              />
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Business State *
              </label>
              <select
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all appearance-none"
                value={formData.state}
                onChange={(e) =>
                  setFormData({ ...formData, state: e.target.value })
                }
              >
                <option value="">Select State</option>
                <option value="NY">New York</option>
                <option value="NJ">New Jersey</option>
                <option value="TX">Texas</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-gray-500 mb-2 ml-1">
                Tobacco / OTP License #
              </label>
              <input
                type="text"
                className="w-full bg-gray-50 border border-gray-200 px-5 py-4 rounded-2xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all"
                value={formData.licenseNumber}
                onChange={(e) =>
                  setFormData({ ...formData, licenseNumber: e.target.value })
                }
              />
            </div>

            <div className="md:col-span-2 mt-4">
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-5 rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-blue-200 hover:bg-blue-700 hover:shadow-none transition-all flex items-center justify-center gap-3"
              >
                Submit Documentation <Send size={20} />
              </button>
            </div>
          </form>
        </div>

        <div className="mt-8 text-center">
          <p className="text-gray-400 text-sm">
            Sincerely, <span className="font-bold text-gray-600">RZ Team</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default PactCompliance;
