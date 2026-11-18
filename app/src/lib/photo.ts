import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { readImage } from './api';

// Lets the shopper pick one photo. Null if they cancel.
export async function pickImage(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  return res.canceled ? null : (res.assets[0]?.uri ?? null);
}

// Shrinks a photo, then has the server read it once. Plenty of detail for a label, much faster to send.
export async function readPhoto(kind: 'label' | 'screenshot', uri: string, gtin?: string) {
  const ref = await ImageManipulator.manipulate(uri).resize({ width: 1600, height: null }).renderAsync();
  const out = await ref.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!out.base64) throw new Error('Could not prepare the photo.');
  return readImage(kind, out.base64, gtin);
}
