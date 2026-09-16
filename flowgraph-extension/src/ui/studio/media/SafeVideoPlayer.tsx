import React from 'react';

export function SafeVideoPlayer({
  src,
  posterUrl,
  mediaId,
  isPlaying,
  onEnded,
  onClock,
  videoRef,
  onError,
  onCanPlay,
  sourceToken,
}: {
  src: string;
  posterUrl?: string;
  mediaId?: string;
  isPlaying: boolean;
  onEnded: () => void;
  onClock?: (current: number, duration: number, sourceToken: string) => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  onError: (sourceToken: string) => void;
  onCanPlay: (sourceToken: string) => void;
  sourceToken: string;
}) {
  const [blobPoster, setBlobPoster] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    const targetUrl = posterUrl || (src.includes('/asb/') ? src : null);
    if (!targetUrl) return;

    if (targetUrl.startsWith('blob:') || targetUrl.startsWith('data:')) {
      setBlobPoster(targetUrl);
      return;
    }

    fetch(targetUrl)
      .then((res) => res.blob())
      .then((blob) => {
        if (active) setBlobPoster(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (active) setBlobPoster(targetUrl);
      });

    return () => {
      active = false;
    };
  }, [posterUrl, src]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {blobPoster && !isPlaying && (
        <img
          src={blobPoster}
          alt="Video Thumbnail"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            zIndex: 0,
          }}
        />
      )}
      <video
        ref={videoRef}
        src={src}
        controls={isPlaying}
        muted
        playsInline
        preload="metadata"
        onEnded={onEnded}
        onError={() => onError(sourceToken)}
        onCanPlay={() => onCanPlay(sourceToken)}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          onClock?.(video.currentTime || 0, video.duration || 0, sourceToken);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          onClock?.(video.currentTime || 0, video.duration || 0, sourceToken);
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          position: 'relative',
          zIndex: isPlaying ? 2 : 0,
        }}
      />
    </div>
  );
}
