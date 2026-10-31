import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux"; // Import Redux Provider
import { store } from "./app/store"; // Import your configured store
import App from "./app/App";
import { AuthProvider } from "./features/auth/context/AuthContext";
import { SiteProvider } from "./features/site/SiteContext";
import "@fontsource-variable/archivo/wdth.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider store={store}>
      <AuthProvider>
        <SiteProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SiteProvider>
      </AuthProvider>
    </Provider>
  </React.StrictMode>
);
