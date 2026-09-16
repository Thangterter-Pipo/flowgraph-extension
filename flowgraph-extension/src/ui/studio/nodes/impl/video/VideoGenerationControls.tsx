import React from 'react';
import { CustomCombobox } from '../../base/CustomCombobox';
import { compactModel, shortAspect } from '../../base/nodeFormatters';

export interface VideoGenerationControlsProps {
  id: string;
  kind: string;
  config: Record<string, any>;
  spec: any;
  activeComboboxId: string | null;
  onToggleCombobox: (id: string | null) => void;
  availableModels: string[];
  availableDurations: string[];
  availableResolutions: string[];
  availableRatios: string[];
  availableBatches: string[];
  dispatchUpdate: (key: string, value: string) => void;
}

export function VideoGenerationControls({
  id,
  config,
  spec,
  activeComboboxId,
  onToggleCombobox,
  availableModels,
  availableDurations,
  availableResolutions,
  availableRatios,
  availableBatches,
  dispatchUpdate,
}: VideoGenerationControlsProps) {
  return (
    <div className="inline-combobox-toolbar nodrag nopan">
      {spec.controls.includes('model') && (
        <CustomCombobox
          id={`${id}-model`}
          activeId={activeComboboxId}
          onToggle={onToggleCombobox}
          wrapClass="model-wrap"
          title="Chọn Mô hình AI"
          label="Model"
          value={config.model || 'Omni 1.1 Flash'}
          options={availableModels.map((m) => ({ value: m, label: compactModel(m) ?? m }))}
          onChange={(val: string) => dispatchUpdate('model', val)}
        />
      )}

      {spec.controls.includes('duration') && (
        <CustomCombobox
          id={`${id}-duration`}
          activeId={activeComboboxId}
          onToggle={onToggleCombobox}
          wrapClass="duration-wrap"
          title="Thời lượng video"
          label="Duration"
          value={config.duration || '8 seconds'}
          options={availableDurations.map((d) => ({ value: d, label: d.replace(' seconds', 's') }))}
          onChange={(val: string) => dispatchUpdate('duration', val)}
        />
      )}

      {spec.controls.includes('resolution') && (
        <CustomCombobox
          id={`${id}-resolution`}
          activeId={activeComboboxId}
          onToggle={onToggleCombobox}
          wrapClass="res-wrap"
          title="Độ phân giải"
          label="Resolution"
          value={config.resolution || '720p'}
          options={availableResolutions.map((res) => ({ value: res, label: res }))}
          onChange={(val: string) => dispatchUpdate('resolution', val)}
        />
      )}

      {spec.controls.includes('aspectRatio') && (
        <CustomCombobox
          id={`${id}-aspectRatio`}
          activeId={activeComboboxId}
          onToggle={onToggleCombobox}
          wrapClass="aspect-wrap"
          title="Tỷ lệ khung hình"
          label="Ratio"
          value={shortAspect(config.aspectRatio) || '16:9'}
          options={availableRatios.map((r) => ({ value: r, label: r }))}
          onChange={(val: string) => dispatchUpdate('aspectRatio', val)}
        />
      )}

      {spec.controls.includes('batch') && (
        <CustomCombobox
          id={`${id}-batchCount`}
          activeId={activeComboboxId}
          onToggle={onToggleCombobox}
          wrapClass="batch-wrap"
          title="Số lượng tạo"
          label="Batch"
          value={config.batchCount || '1'}
          options={availableBatches.map((b) => ({ value: b, label: `x${b}` }))}
          onChange={(val: string) => dispatchUpdate('batchCount', val)}
        />
      )}
    </div>
  );
}
