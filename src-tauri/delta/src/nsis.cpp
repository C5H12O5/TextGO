// NSIS 3.13 writes a solid LZMA stream with an 8 MiB dictionary.
#include "clzma.h"

extern "C" bool textgo_nsis_encode(const unsigned char *input, unsigned int input_size,
                                   unsigned char *output, unsigned int output_size) noexcept {
    try {
        CLZMA encoder;
        if (encoder.Init(9, 8U << 20) != C_OK) return false;
        encoder.SetNextIn(reinterpret_cast<char *>(const_cast<unsigned char *>(input)), input_size);
        encoder.SetNextOut(reinterpret_cast<char *>(output), output_size);
        return encoder.Compress(true) == C_FINISHED && encoder.GetAvailIn() == 0
            && encoder.GetAvailOut() == 0;
    } catch (...) {
        return false;
    }
}
