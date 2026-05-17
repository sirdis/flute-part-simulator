import type { GCodeLine } from '../types';

// Syntax highlight a single GCode raw line
function highlight(raw: string): string {
  // First protect comments
  const cmt = raw.replace(/\([^)]*\)/g, (m) => `<span class="cmt">${esc(m)}</span>`);
  // G/M codes
  const kw = cmt.replace(/\b([GM]\d+)\b/g, '<span class="kw">$1</span>');
  // Numbers (standalone)
  const nums = kw.replace(/(?<=[XYZAIJFS])(-?\d+\.?\d*)/g, '<span class="num">$1</span>');
  return nums;
}

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export class GCodePanel {
  private container: HTMLElement;
  private list: HTMLElement;
  private lines: GCodeLine[] = [];
  private currentIndex = -1;
  private onHover: (lineIndex: number) => void;
  private onClick: (lineIndex: number) => void;
  private elements: HTMLElement[] = [];

  // Virtual scroll state
  private visibleStart = 0;
  private visibleEnd = 0;
  private ROW_HEIGHT = 18;
  private BUFFER = 40;
  private totalHeight = 0;
  private spacerTop!: HTMLElement;
  private spacerBot!: HTMLElement;

  constructor(
    container: HTMLElement,
    list: HTMLElement,
    onHover: (lineIndex: number) => void,
    onClick: (lineIndex: number) => void
  ) {
    this.container = container;
    this.list = list;
    this.onHover = onHover;
    this.onClick = onClick;

    this.spacerTop = document.createElement('div');
    this.spacerBot = document.createElement('div');
    this.list.appendChild(this.spacerTop);
    this.list.appendChild(this.spacerBot);

    this.container.addEventListener('scroll', () => this.updateVisible(), { passive: true });
    container.addEventListener('mouseleave', () => this.onHover(-1));
  }

  load(lines: GCodeLine[]) {
    this.lines = lines;
    this.elements = [];
    this.list.innerHTML = '';
    this.list.appendChild(this.spacerTop);
    this.list.appendChild(this.spacerBot);
    this.totalHeight = lines.length * this.ROW_HEIGHT;
    this.list.style.height = this.totalHeight + 'px';
    this.list.style.position = 'relative';
    this.updateVisible();
  }

  private updateVisible() {
    const scrollTop = this.container.scrollTop;
    const clientH = this.container.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / this.ROW_HEIGHT) - this.BUFFER);
    const end   = Math.min(this.lines.length - 1, Math.ceil((scrollTop + clientH) / this.ROW_HEIGHT) + this.BUFFER);

    if (start === this.visibleStart && end === this.visibleEnd) return;
    this.visibleStart = start;
    this.visibleEnd = end;
    this.renderRows(start, end);
  }

  private renderRows(start: number, end: number) {
    // Remove old rows that are outside range
    const oldRows = this.list.querySelectorAll('.gc-line');
    oldRows.forEach(r => r.remove());

    const frag = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      const line = this.lines[i];
      const row = document.createElement('div');
      row.className = 'gc-line';
      if (line.mark) row.classList.add('mark');
      if (i === this.currentIndex) row.classList.add('current');
      row.dataset['lineIndex'] = String(i);
      row.style.position = 'absolute';
      row.style.top = (i * this.ROW_HEIGHT) + 'px';
      row.style.width = '100%';
      row.style.height = this.ROW_HEIGHT + 'px';
      row.innerHTML = `<span class="gc-lnum">${i + 1}</span><span class="gc-text">${highlight(line.raw)}</span>`;

      row.addEventListener('mouseenter', () => this.onHover(i));
      row.addEventListener('click', () => this.onClick(i));
      frag.appendChild(row);
    }
    this.list.appendChild(frag);
  }

  setCurrentLine(lineIndex: number) {
    if (lineIndex === this.currentIndex) return;

    // Update old current
    const oldEl = this.list.querySelector(`[data-line-index="${this.currentIndex}"]`);
    oldEl?.classList.remove('current');

    this.currentIndex = lineIndex;
    const newEl = this.list.querySelector(`[data-line-index="${lineIndex}"]`);
    newEl?.classList.add('current');
  }

  scrollToLine(lineIndex: number) {
    const targetScroll = lineIndex * this.ROW_HEIGHT;
    const scrollTop = this.container.scrollTop;
    const clientH = this.container.clientHeight;

    if (targetScroll < scrollTop + 20 || targetScroll > scrollTop + clientH - 40) {
      this.container.scrollTop = Math.max(0, targetScroll - clientH / 3);
      this.updateVisible();
    }

    this.setCurrentLine(lineIndex);
  }
}
