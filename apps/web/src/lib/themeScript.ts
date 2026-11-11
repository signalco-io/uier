// Fixed bytes, shared by the static app shell and its CSP hash. Keep the storage key and
// class/color-scheme behavior in step with ClientProvider's next-themes configuration.
// RootLayout emits trusted HTML so client error-boundary remounts do not create executable scripts.
export const themeScript = `if(!['/review-verification','/extension-verification'].includes(location.pathname)){try{const t=localStorage.getItem('theme')||'system';const v=t==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):t;const d=document.documentElement;d.classList.remove('light','dark');d.classList.add(v);if(v==='light'||v==='dark')d.style.colorScheme=v}catch{}}`;
