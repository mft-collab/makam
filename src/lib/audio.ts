/**
 * AudioContext oluşturma yardımcı fonksiyonu. Safari (ve eski WebKit tabanlı
 * tarayıcılar) standart `AudioContext`'i değil, prefixed `webkitAudioContext`'i
 * sağlar — `window` tipinde bu alan tanımlı olmadığından eskiden `window as any`
 * ile erişiliyordu. Burada dar, tek kullanımlık bir tiple erişilir, `any`
 * bulaşması önlenir. Tarayıcı hiçbirini desteklemiyorsa (ör. bazı test/SSR
 * ortamları) null döner — çağıran taraf zaten try/catch içinde.
 */
export const createAudioContext = (): AudioContext | null => {
  const AudioContextCtor =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
};
