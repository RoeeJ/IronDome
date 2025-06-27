import { TubeEditor, TubePosition } from './TubeEditor';
import * as THREE from 'three';

export class TubeEditorUI {
  private editor: TubeEditor;
  private tubeButtons: HTMLButtonElement[] = [];
  private clipboardData: TubePosition | null = null;
  
  constructor(editor: TubeEditor) {
    this.editor = editor;
    this.initializeTubeGrid();
    this.initializeButtons();
    this.updateExportOutput();
  }
  
  private initializeTubeGrid(): void {
    const grid = document.getElementById('tube-grid')!;
    
    for (let i = 0; i < 20; i++) {
      const button = document.createElement('button');
      button.className = 'tube-button';
      button.textContent = (i + 1).toString();
      button.dataset.tubeIndex = i.toString();
      
      button.addEventListener('click', () => {
        this.selectTube(i);
      });
      
      grid.appendChild(button);
      this.tubeButtons.push(button);
    }
  }
  
  private initializeButtons(): void {
    // Clear tube button
    const clearButton = document.getElementById('clear-tube')!;
    clearButton.addEventListener('click', () => {
      this.editor.clearCurrentTube();
    });
    
    // Copy/Paste buttons
    const copyButton = document.getElementById('copy-tube')!;
    const pasteButton = document.getElementById('paste-tube')!;
    
    copyButton.addEventListener('click', () => {
      this.clipboardData = this.editor.copyTubeData();
      if (this.clipboardData) {
        copyButton.textContent = 'Copied!';
        setTimeout(() => {
          copyButton.textContent = 'Copy';
        }, 1000);
      }
    });
    
    pasteButton.addEventListener('click', () => {
      if (this.clipboardData) {
        this.editor.pasteTubeData(this.clipboardData);
      }
    });
    
    // Export buttons
    const exportButton = document.getElementById('export-button')!;
    const downloadButton = document.getElementById('download-button')!;
    
    exportButton.addEventListener('click', () => {
      const textarea = document.getElementById('export-output') as HTMLTextAreaElement;
      textarea.select();
      document.execCommand('copy');
      
      exportButton.textContent = 'Copied to Clipboard!';
      setTimeout(() => {
        exportButton.textContent = 'Export to Clipboard';
      }, 2000);
    });
    
    downloadButton.addEventListener('click', () => {
      const config = this.generateExportConfig();
      const blob = new Blob([config], { type: 'text/typescript' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = 'BatteryTubeConfig.ts';
      a.click();
      
      URL.revokeObjectURL(url);
    });
    
    // Import button
    const importButton = document.getElementById('import-button')!;
    const importFile = document.getElementById('import-file') as HTMLInputElement;
    
    importButton.addEventListener('click', () => {
      importFile.click();
    });
    
    importFile.addEventListener('change', async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        this.importConfiguration(text);
      } catch (error) {
        console.error('Failed to import file:', error);
        alert('Failed to import configuration file');
      }
    });
    
    // Apply position button
    const applyPositionBtn = document.getElementById('apply-position')!;
    applyPositionBtn.addEventListener('click', () => {
      this.applyFineTunePosition();
    });
  }
  
  private selectTube(index: number): void {
    // Update button states
    this.tubeButtons.forEach((btn, i) => {
      btn.classList.remove('active');
      if (i === index) {
        btn.classList.add('active');
      }
    });
    
    // Update current tube display
    document.getElementById('current-tube-number')!.textContent = `Tube ${index + 1}`;
    
    // Select in editor
    this.editor.selectTube(index);
  }
  
  public updateCurrentTubeInfo(tube: TubePosition): void {
    const statusEl = document.getElementById('current-tube-status')!;
    const startEl = document.getElementById('start-coords')!;
    const endEl = document.getElementById('end-coords')!;
    const directionEl = document.getElementById('direction-coords')!;
    
    // Update status
    if (!tube.start) {
      statusEl.textContent = 'Empty - Click to set start position';
      statusEl.style.color = '#888';
    } else if (!tube.end) {
      statusEl.textContent = 'In Progress - Click to set end position';
      statusEl.style.color = '#ffaa00';
    } else {
      statusEl.textContent = 'Complete';
      statusEl.style.color = '#00ff88';
    }
    
    // Update coordinates
    startEl.textContent = tube.start 
      ? `(${tube.start.x.toFixed(2)}, ${tube.start.y.toFixed(2)}, ${tube.start.z.toFixed(2)})`
      : '-';
      
    endEl.textContent = tube.end
      ? `(${tube.end.x.toFixed(2)}, ${tube.end.y.toFixed(2)}, ${tube.end.z.toFixed(2)})`
      : '-';
      
    directionEl.textContent = tube.direction
      ? `(${tube.direction.x.toFixed(3)}, ${tube.direction.y.toFixed(3)}, ${tube.direction.z.toFixed(3)})`
      : '-';
      
    // Update fine-tune inputs
    const startXInput = document.getElementById('start-x') as HTMLInputElement;
    const startYInput = document.getElementById('start-y') as HTMLInputElement;
    const startZInput = document.getElementById('start-z') as HTMLInputElement;
    const endXInput = document.getElementById('end-x') as HTMLInputElement;
    const endYInput = document.getElementById('end-y') as HTMLInputElement;
    const endZInput = document.getElementById('end-z') as HTMLInputElement;
    
    if (tube.start) {
      startXInput.value = tube.start.x.toFixed(3);
      startYInput.value = tube.start.y.toFixed(3);
      startZInput.value = tube.start.z.toFixed(3);
    } else {
      startXInput.value = '';
      startYInput.value = '';
      startZInput.value = '';
    }
    
    if (tube.end) {
      endXInput.value = tube.end.x.toFixed(3);
      endYInput.value = tube.end.y.toFixed(3);
      endZInput.value = tube.end.z.toFixed(3);
    } else {
      endXInput.value = '';
      endYInput.value = '';
      endZInput.value = '';
    }
  }
  
  public onTubeCompleted(index: number): void {
    this.tubeButtons[index].classList.add('complete');
    this.updateCompletedCount();
    this.updateExportOutput();
  }
  
  public onTubeCleared(index: number): void {
    this.tubeButtons[index].classList.remove('complete', 'in-progress');
    this.updateCompletedCount();
    this.updateExportOutput();
  }
  
  public onModelLoaded(): void {
    // Enable all buttons
    this.tubeButtons.forEach(btn => {
      btn.disabled = false;
    });
  }
  
  public updateCompletedCount(): void {
    const tubes = this.editor.getTubePositions();
    const completed = tubes.filter(t => t.start && t.end).length;
    
    document.getElementById('completed-count')!.textContent = `${completed} / 20`;
    
    // Update button states
    tubes.forEach((tube, i) => {
      const button = this.tubeButtons[i];
      button.classList.remove('complete', 'in-progress');
      
      if (tube.start && tube.end) {
        button.classList.add('complete');
      } else if (tube.start) {
        button.classList.add('in-progress');
      }
    });
  }
  
  private updateExportOutput(): void {
    const config = this.generateExportConfig();
    const textarea = document.getElementById('export-output') as HTMLTextAreaElement;
    textarea.value = config;
  }
  
  private generateExportConfig(): string {
    const tubes = this.editor.getTubePositions();
    
    let output = `// Battery Tube Configuration
// Generated by Tube Position Editor
// ${new Date().toISOString()}

import * as THREE from 'three';

export interface TubeConfig {
  id: number;
  start: { x: number; y: number; z: number };
  end: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

export const BATTERY_TUBE_CONFIG: TubeConfig[] = [
`;
    
    tubes.forEach((tube, index) => {
      if (tube.start && tube.end && tube.direction) {
        output += `  {
    id: ${tube.id},
    start: { x: ${tube.start.x.toFixed(3)}, y: ${tube.start.y.toFixed(3)}, z: ${tube.start.z.toFixed(3)} },
    end: { x: ${tube.end.x.toFixed(3)}, y: ${tube.end.y.toFixed(3)}, z: ${tube.end.z.toFixed(3)} },
    direction: { x: ${tube.direction.x.toFixed(3)}, y: ${tube.direction.y.toFixed(3)}, z: ${tube.direction.z.toFixed(3)} }
  }`;
        
        if (index < tubes.length - 1) {
          output += ',\n';
        }
      }
    });
    
    output += `
];

// Helper function to convert config to Three.js vectors
export function getTubeVectors(tubeId: number): {
  start: THREE.Vector3;
  end: THREE.Vector3;
  direction: THREE.Vector3;
} | null {
  const config = BATTERY_TUBE_CONFIG.find(t => t.id === tubeId);
  if (!config) return null;
  
  return {
    start: new THREE.Vector3(config.start.x, config.start.y, config.start.z),
    end: new THREE.Vector3(config.end.x, config.end.y, config.end.z),
    direction: new THREE.Vector3(config.direction.x, config.direction.y, config.direction.z)
  };
}
`;
    
    return output;
  }
  
  private importConfiguration(fileContent: string): void {
    try {
      // Try to parse as TypeScript or JSON
      let tubeConfigs: any[] = [];
      
      if (fileContent.includes('BATTERY_TUBE_CONFIG')) {
        // Parse TypeScript file
        const match = fileContent.match(/BATTERY_TUBE_CONFIG[^=]*=\s*\[([\s\S]*?)\];/);
        if (match) {
          // Extract the array content and evaluate it
          const arrayContent = match[1];
          // This is a bit hacky but works for simple object literals
          const jsonStr = arrayContent
            .replace(/id:/g, '"id":')
            .replace(/start:/g, '"start":')
            .replace(/end:/g, '"end":')
            .replace(/direction:/g, '"direction":')
            .replace(/x:/g, '"x":')
            .replace(/y:/g, '"y":')
            .replace(/z:/g, '"z":')
            .replace(/\s+/g, ' ')
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']');
          
          try {
            tubeConfigs = JSON.parse(`[${jsonStr}]`);
          } catch (e) {
            console.error('Failed to parse TypeScript config:', e);
          }
        }
      } else {
        // Try as JSON
        tubeConfigs = JSON.parse(fileContent);
      }
      
      if (!Array.isArray(tubeConfigs)) {
        throw new Error('Invalid configuration format');
      }
      
      // Import the configurations
      this.editor.importTubeConfigurations(tubeConfigs);
      
      // Update UI
      this.updateCompletedCount();
      this.updateExportOutput();
      
      alert(`Successfully imported ${tubeConfigs.length} tube configurations!`);
      
    } catch (error) {
      console.error('Failed to parse configuration:', error);
      alert('Failed to parse configuration file. Please ensure it\'s a valid TypeScript or JSON file.');
    }
  }
  
  private applyFineTunePosition(): void {
    const currentIndex = this.editor.getCurrentTubeIndex();
    if (currentIndex < 0) {
      alert('Please select a tube first');
      return;
    }
    
    const startX = parseFloat((document.getElementById('start-x') as HTMLInputElement).value);
    const startY = parseFloat((document.getElementById('start-y') as HTMLInputElement).value);
    const startZ = parseFloat((document.getElementById('start-z') as HTMLInputElement).value);
    const endX = parseFloat((document.getElementById('end-x') as HTMLInputElement).value);
    const endY = parseFloat((document.getElementById('end-y') as HTMLInputElement).value);
    const endZ = parseFloat((document.getElementById('end-z') as HTMLInputElement).value);
    
    // Validate inputs
    if (!isNaN(startX) && !isNaN(startY) && !isNaN(startZ) && 
        !isNaN(endX) && !isNaN(endY) && !isNaN(endZ)) {
      
      const tubeData: TubePosition = {
        id: currentIndex,
        start: new THREE.Vector3(startX, startY, startZ),
        end: new THREE.Vector3(endX, endY, endZ),
        direction: new THREE.Vector3(endX - startX, endY - startY, endZ - startZ).normalize()
      };
      
      this.editor.applyTubePosition(tubeData);
      this.updateCompletedCount();
      this.updateExportOutput();
    } else {
      alert('Please enter valid numbers for all coordinates');
    }
  }
}