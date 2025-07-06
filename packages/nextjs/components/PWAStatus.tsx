"use client";

import { useEffect, useState } from "react";

export const PWAStatus = () => {
  const [isInstalled, setIsInstalled] = useState(false);
  const [isSupported, setIsSupported] = useState(false);

  useEffect(() => {
    // Check if app is installed
    const checkInstalled = () => {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
      }
    };

    // Check if PWA is supported
    const checkSupported = () => {
      if ("serviceWorker" in navigator && "BeforeInstallPromptEvent" in window) {
        setIsSupported(true);
      }
    };

    checkInstalled();
    checkSupported();
  }, []);

  if (!isSupported && !isInstalled) return null;

  return (
    <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
      {isInstalled ? (
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
          Running as PWA
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
          PWA Ready - Add to home screen available
        </div>
      )}
    </div>
  );
};
