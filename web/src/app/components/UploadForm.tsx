import { useRef, useState, type DragEvent } from 'react';
import { ACCEPTED_TYPES } from '../../utils/imageValidation.ts';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  maxSizeLabel: string;
}

export function UploadForm({ onFiles, disabled, maxSizeLabel }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  };

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}${disabled ? ' dropzone--disabled' : ''}`}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <p className="dropzone__title">Drag photos or a whole folder here</p>
      <details className="tips" onClick={(e) => e.stopPropagation()}>
        <summary>How to photograph for best results</summary>
        <ul>
          <li><strong>At each fill-up, two photos:</strong> the pump screen (gallons and total), then the dash odometer, within a few minutes of each other.</li>
          <li><strong>Pump:</strong> fill the frame with the display, avoid glare, keep the decimal point visible.</li>
          <li><strong>Dash:</strong> show the total odometer (the big number, ideally with “ODO” or “mi” visible), not the range screen. The trip meter can be in the same photo.</li>
          <li><strong>Keep the original files.</strong> Photos are matched by the time they were taken; sending them through some apps removes it (the time in the file name is used if there is one).</li>
          <li>Fill to the same level each time (first click-off) and untick “Full tank” for partial fills.</li>
        </ul>
      </details>
      <p className="dropzone__hint">JPEG, PNG or WebP · up to {maxSizeLabel} each · photos stay on this device</p>
      <button type="button" className="btn" disabled={disabled} onClick={() => input.current?.click()}>
        Browse files
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </div>
  );
}
