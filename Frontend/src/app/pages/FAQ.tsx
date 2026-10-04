import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { faqs } from "../data/faqdata";
export default function FAQ() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setActiveIndex(activeIndex === index ? null : index);
  };

  return (
    <section className="max-w-4xl mx-auto px-4 py-16">
      <h1 className="text-3xl font-bold text-center mb-10">
        Frequently Asked Questions
      </h1>

      <div className="space-y-4">
        {faqs.map((faq, index) => {
          const isOpen = activeIndex === index;

          return (
            <div
              key={index}
              className="border border-gray-200 rounded-xl shadow-sm bg-white overflow-hidden"
            >
              <button
                onClick={() => toggle(index)}
                className="w-full flex items-center justify-between px-6 py-5 text-left font-medium text-gray-800 hover:bg-gray-50 transition"
              >
                <span>{faq.question}</span>
                <ChevronDown
                  className={`h-5 w-5 transition-transform duration-300 ${
                    isOpen ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                className={`px-6 overflow-hidden transition-all duration-300 ${
                  isOpen ? "max-h-40 pb-5" : "max-h-0"
                }`}
              >
                <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
