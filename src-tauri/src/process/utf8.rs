//! Incremental UTF-8 decoding for process output streams.
//!
//! Both spawn paths (pipe and PTY) read raw bytes from a child in fixed-size
//! chunks. A multi-byte UTF-8 character (emoji, accented letter, box-drawing
//! glyph) can straddle a read boundary — its leading bytes land at the end of
//! one read and its continuation bytes at the start of the next. A naive
//! `String::from_utf8_lossy` per read turns each half into `U+FFFD`, corrupting
//! the character. `Utf8ChunkDecoder` fixes this by buffering only a *trailing
//! incomplete* sequence and stitching it to the next read, while still
//! replacing genuinely invalid bytes with `U+FFFD` exactly like
//! `from_utf8_lossy` does. ASCII bytes (including every ANSI escape byte) are
//! single-byte and are never held back, so escape-sequence framing is
//! unaffected — xterm reassembles split escapes downstream as before.

use std::str;

#[derive(Default)]
pub struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    /// Decode a fresh batch of bytes against any partial sequence carried over
    /// from the previous call. Real invalid bytes are replaced with U+FFFD;
    /// only a trailing incomplete sequence is buffered for the next read.
    pub fn decode(&mut self, bytes: &[u8]) -> Option<String> {
        let mut combined = Vec::with_capacity(self.pending.len() + bytes.len());
        combined.extend_from_slice(&self.pending);
        combined.extend_from_slice(bytes);
        self.pending.clear();

        let mut output = String::new();
        let mut cursor = 0usize;

        while cursor < combined.len() {
            match str::from_utf8(&combined[cursor..]) {
                Ok(rest) => {
                    output.push_str(rest);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    // Bytes [cursor..cursor + valid_up_to] are guaranteed valid UTF-8
                    // by `Utf8Error::valid_up_to`, so decode them infallibly.
                    output.push_str(
                        str::from_utf8(&combined[cursor..cursor + valid_up_to])
                            .expect("valid_up_to guarantees valid UTF-8"),
                    );

                    match error.error_len() {
                        None => {
                            // Trailing incomplete sequence — buffer for next read.
                            self.pending
                                .extend_from_slice(&combined[cursor + valid_up_to..]);
                            break;
                        }
                        Some(invalid_len) => {
                            // Real invalid bytes — emit one replacement and continue scanning.
                            output.push('\u{fffd}');
                            cursor += valid_up_to + invalid_len;
                        }
                    }
                }
            }
        }

        non_empty(output)
    }

    /// Flush any buffered partial sequence at end-of-stream. Anything still
    /// pending is by definition incomplete and is emitted lossily.
    pub fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            let chunk = String::from_utf8_lossy(&self.pending).to_string();
            self.pending.clear();
            non_empty(chunk)
        }
    }
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8ChunkDecoder;

    #[test]
    fn decoder_preserves_split_emoji() {
        let mut decoder = Utf8ChunkDecoder::default();
        let bytes = [
            b'o', b'k', b' ', 0xf0, 0x9f, 0x98, 0x80, b' ', b'd', b'o', b'n', b'e',
        ];
        let expected =
            String::from_utf8(vec![0xf0, 0x9f, 0x98, 0x80, b' ', b'd', b'o', b'n', b'e']).unwrap();

        assert_eq!(decoder.decode(&bytes[..5]).as_deref(), Some("ok "));
        assert_eq!(
            decoder.decode(&bytes[5..]).as_deref(),
            Some(expected.as_str())
        );
        assert_eq!(decoder.finish(), None);
    }

    #[test]
    fn decoder_flushes_incomplete_sequence_lossily_at_eof() {
        let mut decoder = Utf8ChunkDecoder::default();

        assert_eq!(decoder.decode(&[0xf0, 0x9f]), None);
        assert_eq!(decoder.finish().as_deref(), Some("\u{fffd}"));
    }

    #[test]
    fn decoder_buffers_trailing_partial_after_midbuffer_invalid() {
        // ok<INVALID>ok<PARTIAL EMOJI HEAD>
        // Previously, the whole buffer was lossy-decoded, replacing the trailing
        // partial sequence with U+FFFD. It must instead be buffered for the
        // next read so the emoji is decoded correctly.
        let mut decoder = Utf8ChunkDecoder::default();

        let chunk = decoder.decode(&[b'o', b'k', 0xff, b'o', b'k', 0xf0, 0x9f]);
        assert_eq!(chunk.as_deref(), Some("ok\u{fffd}ok"));

        // Feeding the remaining 2 bytes of the smiley completes the emoji.
        let rest = decoder.decode(&[0x98, 0x80]);
        assert_eq!(rest.as_deref(), Some("\u{1f600}"));
        assert_eq!(decoder.finish(), None);
    }

    #[test]
    fn decoder_handles_multiple_invalid_runs() {
        let mut decoder = Utf8ChunkDecoder::default();
        let chunk = decoder.decode(&[b'a', 0xff, 0xff, b'b', 0xfe, b'c']);
        // Each contiguous invalid run emits a single replacement char,
        // matching `String::from_utf8_lossy`'s behavior.
        assert_eq!(chunk.as_deref(), Some("a\u{fffd}\u{fffd}b\u{fffd}c"));
    }

    #[test]
    fn decoder_splits_box_drawing_glyph_across_reads() {
        // A 3-byte box-drawing glyph (U+2500 '─', 0xE2 0x94 0x80) split across a
        // read boundary — the common PTY case for spinners/TUIs. It must survive
        // intact rather than degrading to replacement characters on each half.
        let mut decoder = Utf8ChunkDecoder::default();

        assert_eq!(decoder.decode(&[b'[', 0xe2, 0x94]).as_deref(), Some("["));
        assert_eq!(decoder.decode(&[0x80, b']']).as_deref(), Some("─]"));
        assert_eq!(decoder.finish(), None);
    }
}
