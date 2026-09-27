# Katkı rehberi

Kampüste, Anadolu Üniversitesi Yunus Emre Kampüsü için bağımsız bir öğrenci etkinlik haritasıdır. Küçük ve odaklı katkılar makbuldür.

## Geliştirme

Node.js 24 veya üstü gerekir.

```powershell
npm ci
npm run dev        # arayüz 5173, veri sunucusu 4174
npm test           # tarih, ayrıştırma, eşleştirme ve harita geometrisi testleri
npm run build      # tsc + vite derlemesi, ardından statik SEO sayfaları
```

Değişiklik göndermeden önce `npm test` ve `npm run build` çalıştırın. Derleme, `dist/etkinlik/<slug>/index.html` sayfalarını, `dist/sitemap.xml` ve `dist/robots.txt` dosyalarını üretir; bu çıktılar depoda tutulmaz.

## İlkeler

- Etkinlik kaydı yalnızca üniversitenin herkese açık duyuru sayfalarından toplanır (`scripts/event-source.mjs`). Kaynağı belirsiz veri eklemeyin.
- Harita geometrisi OpenStreetMap türevidir; ODbL atıf koşullarını koruyun (`© OpenStreetMap contributors` görünür kalmalı).
- Uydu zemin karoları ve yükseklik verisi için `README.md` içindeki lisans notlarına bakın; yeni karo kaynağı eklemeden önce kullanım koşullarını doğrulayın.
- Yeri doğrulanmamış bir mekânı haritaya yerleştirmeyin; etkinlik listede kalsın ve ayrıntı bunu yazsın.
- Bağımsız proje ibaresini koruyun; üniversitenin resmî ürünü izlenimi verecek metin, logo veya görsel eklemeyin.

## Değişiklik akışı

1. Konuyu kısa bir başlıkla anlatan bir dal açın.
2. Değişikliği tek bir konuyla sınırlı tutun; ilgisiz biçimlendirme veya yeniden adlandırma yapmayın.
3. Test ve derleme çıktısını pull request açıklamasına yazın.
4. Etkinlik ayrıştırıcısını etkileyen değişikliklerde `tests/event-source.test.mjs` içine küçük bir HTML örneği ekleyin.

## Veri ve gizlilik

Depoya kişisel veri, API anahtarı veya `.env` dosyası koymayın. `DEEPSEEK_HANDOFF.md` gibi dahili notlar sürüm kontrolüne girmez.
