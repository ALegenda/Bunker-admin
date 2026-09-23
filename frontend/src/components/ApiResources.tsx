import React, { useEffect, useState } from 'react';
import { apiResponse } from '../api.js';
import { backendUrl, isBackendResource, remoteApi } from '../urls.js';
import { sessionToken } from '../pages-session.js';

export function ApiImage({ src = '', ...props }: React.ImgHTMLAttributes<HTMLImageElement>) {
  const authenticated = remoteApi && isBackendResource(src) && Boolean(sessionToken());
  const [loaded, setLoaded] = useState<{ src: string; url: string } | null>(null);
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    let url = '';
    apiResponse(src, { signal: controller.signal })
      .then((r) => r.blob())
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setLoaded({ src, url });
      })
      .catch(() => {
        /* Keep alt text when the resource is unavailable. */
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, authenticated]);
  const imageUrl = authenticated ? (loaded?.src === src ? loaded.url : undefined) : backendUrl(src);
  return <img {...props} src={imageUrl} />;
}

export function ApiLink({
  href = '',
  children,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [error, setError] = useState('');
  return (
    <>
      <a
        {...props}
        href={backendUrl(href)}
        onClick={async (event) => {
          if (!remoteApi || !isBackendResource(href) || !sessionToken()) return;
          event.preventDefault();
          setError('');
          const preview = window.open('about:blank', '_blank');
          if (preview) preview.opener = null;
          try {
            const response = await apiResponse(href);
            let blob = await response.blob();
            // A downloaded HTML preview must not inherit script privileges on the Pages origin.
            if (blob.type.includes('text/html'))
              blob = new Blob(
                [
                  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data:">',
                  await blob.text(),
                ],
                { type: 'text/html' },
              );
            const url = URL.createObjectURL(blob);
            if (preview) preview.location.replace(url);
            else {
              const link = document.createElement('a');
              link.href = url;
              link.download = blob.type.includes('pdf') ? 'bunker-rules.pdf' : 'bunker-file';
              link.click();
            }
            setTimeout(() => URL.revokeObjectURL(url), 300000);
          } catch (e) {
            preview?.close();
            setError((e as Error).message);
          }
        }}
      >
        {children}
      </a>
      {error && <span role="alert"> {error}</span>}
    </>
  );
}
