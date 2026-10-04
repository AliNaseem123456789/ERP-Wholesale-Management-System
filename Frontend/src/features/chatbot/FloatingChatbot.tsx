// src/components/FloatingChat.tsx
import React, { useState, useRef, useEffect } from "react";
import { X, Send, MessageCircle, Minimize2, Maximize2 } from "lucide-react";
import { CHATBOT_URL } from "../../config/config";
interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface FloatingChatProps {
  botId?: string;
  apiUrl?: string;
  title?: string;
  welcomeMessage?: string;
  primaryColor?: string;
  userId?: string | null;
}

const FloatingChat: React.FC<FloatingChatProps> = ({
  botId = "smoking",
  apiUrl = CHATBOT_URL,
  title = "SmokeBuddy Assistant",
  welcomeMessage = "Hello! Welcome to SmokeBuddy Wholesale. Need help with products, wholesale pricing, or orders? I'm here to help! 🔥",
  primaryColor = "#8B5CF6",
  userId = null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: welcomeMessage, timestamp: new Date() },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (!isOpen && messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage.role === "assistant") {
        setUnreadCount((prev) => prev + 1);
      }
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setUnreadCount(0);
    }
  }, [isOpen]);
  useEffect(() => {
    if (isOpen && !isMinimized) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetch(`${apiUrl}/api/chat/${botId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: input,
          user_id: userId || localStorage.getItem("userId") || "anonymous",
          conversation_history: messages.slice(-5).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      const data = await response.json();

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error("Chat error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Sorry, I'm having trouble connecting. Please try again or contact support.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const quickSuggestions = [
    "What brands do you carry?",
    "Wholesale pricing",
    "Minimum order amount",
    "Shipping policy",
    "Track my order",
    "Contact support",
  ];

  return (
    <>
      {/* Floating Button - Mobile Optimized */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-4 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-300 hover:scale-110 active:scale-95 md:bottom-6 md:right-6 md:h-14 md:w-14"
          style={{ backgroundColor: primaryColor }}
        >
          <MessageCircle className="h-6 w-6 text-white" />
          {unreadCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-xs font-bold text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}

      {/* Chat Window - Mobile Responsive */}
      {isOpen && (
        <div
          className={`fixed bottom-0 right-0 z-50 flex flex-col bg-white shadow-xl transition-all duration-300 md:bottom-4 md:right-4 md:rounded-2xl
            ${
              isMinimized
                ? "h-14 w-full md:w-80"
                : "h-[100dvh] w-full md:h-[600px] md:w-[420px]"
            }`}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between rounded-t-2xl px-4 py-3 text-white"
            style={{ backgroundColor: primaryColor }}
          >
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
                <MessageCircle className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="text-xs opacity-90">Online • AI Assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="rounded-full p-1 transition-colors hover:bg-white/20"
              >
                {isMinimized ? (
                  <Maximize2 className="h-4 w-4" />
                ) : (
                  <Minimize2 className="h-4 w-4" />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 transition-colors hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Chat Content - Only show when not minimized */}
          {!isMinimized && (
            <>
              {/* Messages */}
              <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-4">
                {messages.map((message, idx) => (
                  <div
                    key={idx}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                        message.role === "user"
                          ? "text-white"
                          : "bg-white text-gray-800 shadow-sm"
                      }`}
                      style={
                        message.role === "user"
                          ? { backgroundColor: primaryColor }
                          : {}
                      }
                    >
                      <p className="whitespace-pre-wrap text-sm">
                        {message.content}
                      </p>
                      <p
                        className={`mt-1 text-xs ${
                          message.role === "user"
                            ? "text-white/70"
                            : "text-gray-400"
                        }`}
                      >
                        {formatTime(message.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl bg-white px-4 py-2 shadow-sm">
                      <div className="flex space-x-1">
                        <div
                          className="h-2 w-2 animate-bounce rounded-full"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <div
                          className="h-2 w-2 animate-bounce rounded-full delay-100"
                          style={{ backgroundColor: primaryColor }}
                        />
                        <div
                          className="h-2 w-2 animate-bounce rounded-full delay-200"
                          style={{ backgroundColor: primaryColor }}
                        />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Quick Suggestions - Mobile Optimized Horizontal Scroll */}
              <div className="border-t border-gray-100 bg-white px-4 py-2">
                <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
                  {quickSuggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        setTimeout(() => sendMessage(), 100);
                      }}
                      className="whitespace-nowrap rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 transition-colors hover:bg-gray-50 active:bg-gray-100"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>

              {/* Input Area */}
              <div className="border-t border-gray-200 bg-white p-4">
                <div className="flex gap-2">
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Type your message..."
                    className="max-h-32 min-h-[40px] flex-1 resize-none rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2"
                    style={{
                      borderColor: primaryColor,
                      ringColor: primaryColor,
                    }}
                    rows={1}
                  />
                  <button
                    onClick={sendMessage}
                    disabled={isLoading || !input.trim()}
                    className="rounded-xl px-4 py-2 text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: primaryColor }}
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
                <p className="mt-2 text-center text-xs text-gray-400">
                  Powered by AI • 24/7 Support
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add global styles for animations */}
      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-8px); }
        }
        .animate-bounce {
          animation: bounce 1.4s infinite ease-in-out;
        }
        .delay-100 { animation-delay: 0.1s; }
        .delay-200 { animation-delay: 0.2s; }
        
        /* Hide scrollbar for Chrome, Safari and Opera */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        
        /* Hide scrollbar for IE, Edge and Firefox */
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </>
  );
};

export default FloatingChat;
