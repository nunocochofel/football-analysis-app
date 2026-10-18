// Substitui o service worker da app antiga neste endereço: limpa a cache e desregista-se, e
// recarrega as janelas abertas para mostrarem a página de mudança. Não toca no localStorage.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.map((n) => caches.delete(n)));
    await self.registration.unregister();
    const janelas = await self.clients.matchAll({ type: 'window' });
    janelas.forEach((j) => j.navigate(j.url));
  })());
});
