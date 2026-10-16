import React from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";

// Font files are bundled into the build, so the clock looks right offline too.
import "@fontsource/oswald/500.css";
import "@fontsource/oswald/700.css";
import "./styles.css";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {/* "user" = follow the OS "reduce motion" setting for every animation */}
    <MotionConfig reducedMotion="user">
      <App />
    </MotionConfig>
  </React.StrictMode>
);
