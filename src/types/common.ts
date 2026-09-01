export type Localized = {
  en: string;
  hi?: string;
  mr?: string;
};

export type CloudinaryAsset = {
  publicId: string;
  url: string;
  resourceType: string;
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
};
