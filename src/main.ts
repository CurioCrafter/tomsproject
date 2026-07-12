import './styles.css';
import './character-preview.css';
import { Game } from './game/Game';
import type { FrontEndIntentDetail } from './ui/FrontEndController';
import { CharacterPreviewRenderer } from './ui/CharacterPreviewRenderer';
import { frontEndController } from './ui/FrontEndController';
import { ProgressionPanelController } from './ui/ProgressionPanelController';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const characterPreviewCanvas = document.querySelector<HTMLCanvasElement>('#character-preview-canvas');

if (!canvas || !characterPreviewCanvas) {
  throw new Error('Missing required game canvas.');
}

const progressionPanel = new ProgressionPanelController();
const game = new Game(canvas, frontEndController.getProfile());
let characterPreview: CharacterPreviewRenderer | null = null;
const ensureCharacterPreview = (): CharacterPreviewRenderer => {
  characterPreview ??= new CharacterPreviewRenderer(characterPreviewCanvas, frontEndController.getProfile());
  characterPreview.start();
  return characterPreview;
};
const onFrontEndIntent = (event: Event): void => {
  const detail = (event as CustomEvent<FrontEndIntentDetail>).detail;
  if (!detail) return;
  if (detail.type === 'preview' && detail.profile && document.body.dataset.frontEndState === 'creator') {
    ensureCharacterPreview().setProfile(detail.profile);
  } else if (detail.type === 'start' && characterPreview) {
    if (detail.profile) characterPreview.setProfile(detail.profile);
    characterPreview.dispose();
    characterPreview = null;
  }
};
window.addEventListener('celestial-front-end-intent', onFrontEndIntent);
game.start();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.removeEventListener('celestial-front-end-intent', onFrontEndIntent);
    characterPreview?.dispose();
    progressionPanel.dispose();
    game.dispose();
  });
}
