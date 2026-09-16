import React from 'react';
import { getMediaBlob } from '../mediaStorage';

export function SafeImage({ src, alt, mediaId }: { src: string; alt: string; mediaId?: string }) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setIsLoading(true);
    if (!src && !mediaId) {
      setBlobUrl(null);
      setIsLoading(false);
      return;
    }

    // 1. Nếu là Blob hoặc Data URL cục bộ thật sự (không phải dummy)
    if (src && (src.startsWith('blob:') || (src.startsWith('data:') && !src.includes('ZHVtbXk=')))) {
      setBlobUrl(src);
      setIsLoading(false);
      return;
    }

    // 2. Nếu là local mediaId (ảnh kéo từ máy vào: 'local-...' hoặc 'dropped-...')
    if (mediaId && (mediaId.startsWith('local-') || mediaId.startsWith('dropped-'))) {
      void getMediaBlob(mediaId).then((cached) => {
        if (active) {
          if (cached) setBlobUrl(cached);
          setIsLoading(false);
        }
      });
      return;
    }

    // 3. Nếu có mediaId thật trên Google Flow: Quét DOM của tab Google Flow để lấy link signed token proxy chuẩn xác
    const resolveFromDom = async () => {
      try {
        if (typeof chrome !== 'undefined' && chrome.tabs && mediaId) {
          const tabs = await chrome.tabs.query({ url: '*://flow.google.com/*' });
          const flowTab = tabs[0];
          if (flowTab?.id) {
            const injected = await chrome.scripting.executeScript({
              target: { tabId: flowTab.id },
              func: (id: string) => {
                const img = document.querySelector(`img[src*="${id}"]`)
                  || document.querySelector(`[data-media-id="${id}"] img`)
                  || document.querySelector(`[data-media-id="${id}"]`);
                return img?.getAttribute('src') || (img as any)?.currentSrc || (img as any)?.src || null;
              },
              args: [mediaId],
            });
            const domSrc = injected?.[0]?.result;
            // Hỗ trợ cả Google Flow CDN format:
            // 1) /asb/AB-n...
            // 2) flow-content.google/image/...
            if (domSrc && (domSrc.includes('/asb/AB-n') || domSrc.includes('flow-content.google')) && active) {
              const res = await fetch(domSrc);
              const blob = await res.blob();
              if (active) {
                setBlobUrl(URL.createObjectURL(blob));
                setIsLoading(false);
              }
              return;
            }
          }
        }
      } catch {}

      // Nếu src là URL hợp lệ không phải dạng /asb/<uuid>
      if (src && !src.includes('/asb/') && (src.startsWith('http://') || src.startsWith('https://'))) {
        fetch(src)
          .then((res) => res.blob())
          .then((blob) => {
            if (active) {
              setBlobUrl(URL.createObjectURL(blob));
              setIsLoading(false);
            }
          })
          .catch(() => {
            if (active) {
              setBlobUrl(src);
              setIsLoading(false);
            }
          });
      } else if (active) {
        setIsLoading(false);
      }
    };

    void resolveFromDom();

    return () => {
      active = false;
    };
  }, [src, mediaId]);

  if (!blobUrl && !src) {
    return (
      <div className="placeholder-art empty-media-well" aria-hidden="true">
        <span className="empty-media-copy">No photo available</span>
      </div>
    );
  }

  const finalSrc = blobUrl || (src && !src.includes('/asb/') && !src.includes('ZHVtbXk=') ? src : '');
  if (!finalSrc) {
    return (
      <div className="placeholder-art empty-media-well" aria-hidden="true">
        <span className="empty-media-copy">No photo available</span>
      </div>
    );
  }

  return <img src={finalSrc} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}
