export function registerServiceWorker() {
	try {

		if (typeof window === 'undefined') return;

		if (!('serviceWorker' in navigator)) return;

		if (!window.location || window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') return;

		navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
        
	} catch {}
}

registerServiceWorker();
