import React, { useState, useCallback } from 'react';
import { X, Save } from 'lucide-react';
import Cropper from 'react-easy-crop';
import toast from 'react-hot-toast';

/**
 * Reusable circular photo cropper modal.
 *
 * Props:
 *   src        — data URL of the picked image. Modal renders only when truthy.
 *   uploading  — boolean to disable the buttons while the parent's upload is in flight
 *   onSave     — (blob) => void  Receives the cropped JPEG blob (square, 1:1).
 *   onCancel   — () => void      Called when the user closes / cancels.
 *
 * The parent owns file-picking, validation, and the actual upload. This
 * component is purely the crop UI — same logic and styling we had inline
 * inside Profile.jsx, lifted out so Dashboard can reuse it without
 * duplicating ~80 lines.
 */
function getCroppedBlob(imageSrc, croppedAreaPixels) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = croppedAreaPixels.width;
      canvas.height = croppedAreaPixels.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(
        img,
        croppedAreaPixels.x, croppedAreaPixels.y,
        croppedAreaPixels.width, croppedAreaPixels.height,
        0, 0,
        croppedAreaPixels.width, croppedAreaPixels.height
      );
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Crop failed'))),
        'image/jpeg',
        0.92,
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = imageSrc;
  });
}

export default function PhotoCropperModal({ src, uploading, onSave, onCancel }) {
  const [pos,  setPos]  = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [areaPixels, setAreaPixels] = useState(null);

  const onCropComplete = useCallback((_a, ap) => setAreaPixels(ap), []);

  const handleSave = async () => {
    if (!src || !areaPixels) return;
    try {
      const blob = await getCroppedBlob(src, areaPixels);
      onSave(blob);
    } catch (err) {
      toast.error("Couldn't process this image. Please try a different photo.");
    }
  };

  // Reset transient state whenever a fresh image opens.
  React.useEffect(() => {
    setPos({ x: 0, y: 0 });
    setZoom(1);
    setAreaPixels(null);
  }, [src]);

  if (!src) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h3 className="text-[17px] font-semibold text-slate-800">Position your photo</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">Drag to move · scroll or use the slider to zoom</p>
          </div>
          <button
            onClick={onCancel}
            disabled={uploading}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-slate-100 text-slate-500 disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="relative h-[320px] bg-slate-900">
          <Cropper
            image={src}
            crop={pos}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setPos}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
          />
        </div>

        <div className="px-5 py-3 border-t border-slate-100">
          <label className="text-[13px] font-medium text-slate-500 block mb-1">Zoom</label>
          <input
            type="range"
            min={1}
            max={3}
            step={0.05}
            value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
        </div>

        <div className="px-5 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={uploading}
            className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-[15px] font-semibold hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={uploading || !areaPixels}
            className="bg-[#1a73e8] hover:bg-[#1557B0] text-white px-4 py-2 rounded-lg text-[15px] font-semibold disabled:opacity-60 flex items-center gap-1.5"
          >
            <Save size={13} /> {uploading ? 'Saving…' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
