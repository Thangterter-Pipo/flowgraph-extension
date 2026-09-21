import type { ElementType } from 'react';
import {
  MessageSquareText,
  Sparkles,
  Image as ImageIcon,
  Upload,
  Crop,
  Maximize2,
  Film,
  PlaySquare,
  GitCompare,
  FastForward,
  Layers,
  Download,
  Database,
  Eye,
  UserCheck,
  UserPlus,
  Users,
  Bot,
  Split,
  Clock,
  StickyNote,
  Ban,
  Sliders,
  CheckCircle2,
} from 'lucide-react';

export type NodePresentationArchetype =
  | 'prompt'
  | 'gemini'
  | 'image-gen'
  | 'video-gen'
  | 'media-preview'
  | 'character-card'
  | 'transform'
  | 'download'
  | 'logic'
  | 'utility';

export interface NodePresentationSpec {
  kind: string;
  archetype: NodePresentationArchetype;
  icon: ElementType;
  category: 'INPUT' | 'AI' | 'IMAGE' | 'VIDEO' | 'CHARACTER' | 'TRANSFORM' | 'OUTPUT' | 'LOGIC';
  defaultTone: 'purple' | 'blue' | 'green' | 'orange';
  isMediaHolder: boolean;
  isVideoMedia: boolean;
  controls: Array<'model' | 'duration' | 'resolution' | 'aspectRatio' | 'batch' | 'style' | 'targetResolution' | 'delay'>;
  width?: number;
  height?: number;
}

export const NODE_PRESENTATION_SPECS: Record<string, NodePresentationSpec> = {
  // 1. INPUTS
  prompt: {
    kind: 'prompt',
    archetype: 'prompt',
    icon: MessageSquareText,
    category: 'INPUT',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
  },
  uploadImage: {
    kind: 'uploadImage',
    archetype: 'transform',
    icon: Upload,
    category: 'INPUT',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: [],
  },
  imageInput: {
    kind: 'imageInput',
    archetype: 'transform',
    icon: Database,
    category: 'INPUT',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: [],
  },
  videoInput: {
    kind: 'videoInput',
    archetype: 'transform',
    icon: Film,
    category: 'INPUT',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: [],
  },
  mediaInput: {
    kind: 'mediaInput',
    archetype: 'transform',
    icon: Layers,
    category: 'INPUT',
    defaultTone: 'orange',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: [],
  },

  // 2. AI
  gemini: {
    kind: 'gemini',
    archetype: 'gemini',
    icon: Sparkles,
    category: 'AI',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: ['model', 'style'],
  },
  creationAgent: {
    kind: 'creationAgent',
    archetype: 'logic',
    icon: Bot,
    category: 'AI',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
  },

  // 3. IMAGE
  t2i: {
    kind: 't2i',
    archetype: 'image-gen',
    icon: ImageIcon,
    category: 'IMAGE',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: ['model', 'aspectRatio', 'batch'],
  },
  imageUpscale: {
    kind: 'imageUpscale',
    archetype: 'transform',
    icon: Maximize2,
    category: 'IMAGE',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: ['targetResolution'],
  },
  imageTransform: {
    kind: 'imageTransform',
    archetype: 'transform',
    icon: Crop,
    category: 'IMAGE',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: [],
  },

  // 4. VIDEO
  t2v: {
    kind: 't2v',
    archetype: 'video-gen',
    icon: PlaySquare,
    category: 'VIDEO',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['model', 'duration', 'resolution', 'aspectRatio'],
  },
  i2v: {
    kind: 'i2v',
    archetype: 'video-gen',
    icon: Film,
    category: 'VIDEO',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['model', 'duration', 'resolution', 'aspectRatio'],
  },
  interpolation: {
    kind: 'interpolation',
    archetype: 'video-gen',
    icon: GitCompare,
    category: 'VIDEO',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['model', 'duration', 'resolution', 'aspectRatio'],
  },
  extend: {
    kind: 'extend',
    archetype: 'video-gen',
    icon: FastForward,
    category: 'VIDEO',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['model', 'duration', 'resolution'],
  },
  reference: {
    kind: 'reference',
    archetype: 'video-gen',
    icon: Layers,
    category: 'VIDEO',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['model', 'duration', 'resolution', 'aspectRatio'],
  },
  videoUpscale: {
    kind: 'videoUpscale',
    archetype: 'transform',
    icon: Maximize2,
    category: 'VIDEO',
    defaultTone: 'orange',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: ['targetResolution'],
  },

  // 5. CHARACTER
  characterCreate: {
    kind: 'characterCreate',
    archetype: 'character-card',
    icon: UserPlus,
    category: 'CHARACTER',
    defaultTone: 'orange',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: [],
  },
  characterAssign: {
    kind: 'characterAssign',
    archetype: 'character-card',
    icon: UserCheck,
    category: 'CHARACTER',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: false,
    controls: [],
  },
  likenessCheck: {
    kind: 'likenessCheck',
    archetype: 'logic',
    icon: CheckCircle2,
    category: 'CHARACTER',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
  },
  likenessList: {
    kind: 'likenessList',
    archetype: 'logic',
    icon: Users,
    category: 'CHARACTER',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
  },

  // 6. OUTPUT
  download: {
    kind: 'download',
    archetype: 'download',
    icon: Download,
    category: 'OUTPUT',
    defaultTone: 'blue',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: [],
  },
  preview: {
    kind: 'preview',
    archetype: 'media-preview',
    icon: Eye,
    category: 'OUTPUT',
    defaultTone: 'green',
    isMediaHolder: true,
    isVideoMedia: true,
    controls: [],
  },

  // 7. LOGIC & UTILITY
  condition: {
    kind: 'condition',
    archetype: 'logic',
    icon: Split,
    category: 'LOGIC',
    defaultTone: 'orange',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
    width: 210,
  },
  delay: {
    kind: 'delay',
    archetype: 'utility',
    icon: Clock,
    category: 'LOGIC',
    defaultTone: 'orange',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: ['delay'],
    width: 210,
  },
  note: {
    kind: 'note',
    archetype: 'utility',
    icon: StickyNote,
    category: 'LOGIC',
    defaultTone: 'purple',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
    width: 220,
  },
  cancelGeneration: {
    kind: 'cancelGeneration',
    archetype: 'utility',
    icon: Ban,
    category: 'LOGIC',
    defaultTone: 'orange',
    isMediaHolder: false,
    isVideoMedia: false,
    controls: [],
    width: 210,
  },
};

export function getPresentationSpec(kind: string): NodePresentationSpec {
  return (
    NODE_PRESENTATION_SPECS[kind] || {
      kind,
      archetype: 'utility',
      icon: Sliders,
      category: 'LOGIC',
      defaultTone: 'purple',
      isMediaHolder: false,
      isVideoMedia: false,
      controls: [],
    }
  );
}

export function isVideoPresentationNode(kind: string): boolean {
  return getPresentationSpec(kind).isVideoMedia;
}
