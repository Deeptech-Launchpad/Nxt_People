import React, { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

export default function MobileBlocker({ children }) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      // Very strict check to block anything that even remotely looks like a phone, 
      // even if they "Request Desktop Site".
      // 1. Check user agent for common mobile strings
      const uaMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      // 2. Check screen dimensions. If max width is small, it's a mobile screen spoofing desktop.
      // Phone screens, even large ones like iPhone Max, usually don't exceed 950px in logical width.
      const screenSmall = Math.max(window.screen.width, window.screen.height) <= 950 || Math.min(window.screen.width, window.screen.height) <= 500;
      
      // 3. Max touch points check combined with small screen (to avoid blocking touch laptops)
      const isTouchScreen = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window);
      
      // If user agent says mobile, OR if it's a small touch screen, block it.
      if (uaMobile || (screenSmall && isTouchScreen)) {
        setIsMobile(true);
      } else {
        setIsMobile(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (isMobile) {
    return (
      <div className="fixed inset-0 bg-slate-900 z-[9999] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 bg-red-500/20 rounded-full flex items-center justify-center mb-6">
          <Smartphone size={40} className="text-red-500" />
        </div>
        <h1 className="text-3xl font-bold text-white mb-3 tracking-tight">Mobile Access Restricted</h1>
        <p className="text-slate-400 text-base max-w-[300px] leading-relaxed">
          For security and integrity reasons, accessing this portal via a mobile device is strictly prohibited. 
          Please log in using a Desktop or Laptop computer.
        </p>
      </div>
    );
  }

  return children;
}
