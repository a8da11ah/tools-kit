/**
 * Utility functions for building standard Hexadecimal dump views.
 */

export interface HexDumpLine {
  offsetHex: string;
  hexBytes: string[];
  asciiChars: string[];
}

/**
 * Builds a structured hex dump array from a continuous hex string.
 * This array is ready to be rendered easily in React rows.
 * 
 * @param hexString The continuous hexadecimal string (e.g. "FF00A1...")
 * @param bytesPerLine Number of bytes to show on each line (usually 16)
 * @returns Array of parsed lines ready for rendering
 */
export function buildHexDump(hexString: string, bytesPerLine = 16): HexDumpLine[] {
  // Strip any whitespace
  const cleanHex = hexString.replace(/\s+/g, "").toUpperCase();
  const bytes: number[] = [];
  
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.slice(i, i + 2), 16));
  }

  const lines: HexDumpLine[] = [];
  
  for (let i = 0; i < bytes.length; i += bytesPerLine) {
    const chunk = bytes.slice(i, i + bytesPerLine);
    
    // Offset (e.g., 00000000)
    const offsetHex = i.toString(16).padStart(8, "0").toUpperCase();
    
    // The hex byte values
    const hexBytes = chunk.map(b => b.toString(16).padStart(2, "0").toUpperCase());
    
    // ASCII representation (printables only, replace others with '.')
    const asciiChars = chunk.map(b => {
      return (b >= 32 && b <= 126) ? String.fromCharCode(b) : ".";
    });

    lines.push({ offsetHex, hexBytes, asciiChars });
  }

  return lines;
}
