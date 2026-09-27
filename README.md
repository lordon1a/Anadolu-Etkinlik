# Kampüste.

Anadolu Üniversitesi Yunus Emre Kampüsü için bağımsız bir öğrenci etkinlik haritası. Resmî [etkinlik duyurularını](https://www.anadolu.edu.tr/etkinlikler) okur; saat, kategori ve mekâna göre keşif sağlar. Harita, OpenStreetMap'teki gerçek kampüs sınırı, bina ayak izleri ve yollardan üretilir; 3B görünüm aynı geometriden çizilen stilize zemin ve gerçek yükseklik verisiyle eğimlendirilir. Uydu görüntüsü isteğe bağlı bir katmandır ve yalnızca istendiğinde sağlayıcıdan yüklenir. **Üniversitenin resmî sitesi değildir.**

> **Canlı demo:** https://anadolu-etkinlik.vercel.app — farklı bir alan adına dağıtırsanız `SITE_URL` ortam değişkenini ayarlayın (aşağıya bakın).
>
> **Depo:** https://github.com/lordon1a/Anadolu-Etkinlik

> **Ekran görüntüsü (yer tutucu):** `docs/screenshot.png` dosyasını ekleyip bu satırı
> `![Kampüste ana sayfa](docs/screenshot.png)` ile değiştirin. Önerilen kare: masaüstü 1440×1000, harita ve etkinlik listesi görünürken.

## Özellikler

- 3B minyatür kampüs (gerçek ayak izleri, yollar, gölet, kapılar) ve WebGL yoksa 2B SVG yedek. Zemin, OSM geometrisinden çizilen stilize bir dokudur; köşedeki **Uydu** düğmesi Esri World Imagery karolarını yalnızca istendiğinde canlı yükler ve tercih hatırlanır.
- Harita araması: mekân, OSM'de etiketli bina ve etkinlik adlarında Türkçe duyarsız eşleştirme; `↑`/`↓`/`Enter`/`Esc` ve `/` kısayolu, seçimde kamera binaya uçar.
- Etkinlikleri zaman (şimdi / bugün / yarın / bu hafta), kategori ve mekâna göre filtreleme.
- Yalnızca doğrulanmış bina ayak izlerine pin koyar; eşleşmeyen mekân listede kalır ve ayrıntı bunu yazar.
- Paylaşılabilir bağlantı: `/?etkinlik=<id>`; her etkinlik için ayrıca arama motorlarına açık statik sayfa.
- Bağımsız statik çalışma: sunucu yoksa istemci `public/events.json` dosyasını okur.

## Kurulum

Node.js 24 veya üstü gerekir.

```powershell
npm ci
npm run dev
```

Tarayıcıda `http://127.0.0.1:5173/` adresini açın. Vite arayüzü, `127.0.0.1:4174` adresindeki veri sunucusuna bağlanır. Veri sunucusu açılışta en son kaydı okur ve gerekiyorsa etkinlikleri günceller. Tek başına üretim sunucusu için:

```powershell
npm run build
npm run preview
```

`PORT` ve `HOST` ortam değişkenleri üretim sunucusunun adresini değiştirir. Varsayılan `127.0.0.1:4174` sadece aynı bilgisayardan erişilebilir.

## Komutlar

| Komut | İşlev |
| --- | --- |
| `npm run dev` | Arayüz ve veri sunucusunu birlikte açar |
| `npm run update:events` | Etkinlik kaydını hemen yeniler |
| `npm test` | Tarih, ayrıştırma, eşleştirme ve harita geometrisi testleri |
| `npm run build` | TypeScript kontrolü, üretim derlemesi ve statik SEO sayfaları |
| `npm run postbuild` | Yalnızca SEO adımı: etkinlik sayfaları, `sitemap.xml`, `robots.txt` |
| `npm run preview` | Derlenmiş siteyi veri sunucusuyla açar |
| `npm run og` | Paylaşım görselini ve ikonları yeniden üretir (yerel Chrome gerekir) |

Harita geometrisini ve zemin katmanını yeniden üretmek için:

```powershell
node research/build-campus-data.mjs   # OSM → src/data/campus-geometry.json, data/venues.json
node research/build-ground-data.mjs   # yükseklik → research/ground/ground.json (karşılaştırma karoları research/ground/tiles, gitignore'lu)
```

## Mimari

```
public/events.json ──┬─► server/index.mjs  /api/events ──┐
                     │   (Express, iki saatte bir tazeler)│
                     └─► statik /events.json ─────────────┴─► src/App.tsx (React SPA, 5 dk'da bir yeniler)
github Actions ──► scripts/refresh-events.mjs ──► scripts/event-source.mjs ──► anadolu.edu.tr
npm run build ──► vite (dist/) ──► scripts/build-seo.mjs ──► dist/etkinlik/*, sitemap, robots
```

- `server/index.mjs` yalnızca yerel geliştirme ve kendi sunucunuzda barındırma içindir; Vercel gibi statik ortamlarda çalışmaz.
- İstemci `/api/events` adresini dener; uç nokta yoksa veya JSON dönmezse statik `/events.json` dosyasına düşer. Böylece aynı derleme hem Express'li hem sunucusuz ortamda çalışır.
- `scripts/build-seo.mjs`, `npm run build` sonunda otomatik çalışır (`postbuild`).

## Yayına alma

### Vercel (statik)

1. Depoyu Vercel'e bağlayın; `vercel.json` çerçeve, derleme ve önbellek ayarlarını taşır (`framework: vite`, çıktı `dist/`).
2. Etkinlik sayfaları gerçek dosya olarak üretildiği için `dist/etkinlik/<slug>/index.html` doğrudan sunulur; kalan yollar SPA'ya yazılır.
3. `SITE_URL` ortam değişkenini gerçek alan adınıza ayarlayın (ör. `https://kampuste.example`). Ayarlanmazsa derleme varsayılan olarak `https://anadolu-etkinlik.vercel.app` adresini kullanır; canonical, Open Graph ve sitemap adresleri bu değere göre üretilir.
4. Etkinlik verisi Vercel cron'u ile değil, GitHub Actions ile yenilenir; her bot commit'i yeni bir dağıtım tetikler.

### GitHub Actions

`.github/workflows/refresh-events.yml` iki saatte bir (UTC, yerel saatle tek saatler) `npm run update:events` çalıştırır ve `public/events.json` değiştiyse bot commit'i ile push eder. Betik yalnızca tam bir tur başarıyla bittiğinde dosyayı yazar; hata durumunda son başarılı kayıt korunur ve adım kırmızıya döner.

## SEO

- `index.html`: Türkçe başlık ve açıklama, canonical, Open Graph/Twitter kartları, `WebSite` + `Organization` JSON-LD, favicon ve manifest.
- Her etkinlik için `dist/etkinlik/<slug>/index.html`: başlık, açıklama, tarih, mekân, afiş, resmî duyuru bağlantısı, "Haritada gör" bağlantısı ve `schema.org/Event` JSON-LD (konum adresi Yunus Emre Kampüsü, Tepebaşı/Eskişehir).
- `dist/sitemap.xml` ana sayfayı ve sürmekte olan/gelecek etkinlikleri listeler; bitmiş etkinliklerin sayfası yayında kalır ama sitemap'e girmez. `dist/robots.txt` sitemap'i bildirir.

## Veri kaynakları ve lisanslar

- **Kod:** MIT ([LICENSE](LICENSE)).
- **Harita geometrisi:** 26.09.2026 tarihli OpenStreetMap dışa aktarımından üretilir (kampüs sınırı, bina ayak izleri, yollar, su ve yeşil alanlar, kapılar). Veri `© OpenStreetMap contributors`, lisans [ODbL 1.0](https://www.openstreetmap.org/copyright). Atıf haritanın altında ve 3B görünümde görünür; türetilmiş geometri dosyaları da ODbL kapsamındadır.
- **3B zemin:** varsayılan olarak OSM geometrisinden çizilen stilize bir dokudur (yeşil alanlar, krem yollar, gölet, kampüs sınırı); arazi yüksekliği DEM'den gelir. Uydu görüntüsü **depoda ve derlemede tutulmaz**.
- **Uydu katmanı (isteğe bağlı):** [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) karoları, yalnızca ziyaretçi **Uydu** düğmesine bastığında tarayıcıdan doğrudan `server.arcgisonline.com` adresinden yüklenir; karo indirilmez, önbelleğe alınmaz ve yeniden dağıtılmaz (servis dışa aktarıma kapalıdır: `exportTilesAllowed: false`). Katman açıkken tam telif satırı görünür: “Kaynak: Esri, Vantor, Earthstar Geographics ve GIS kullanıcı topluluğu”. Ayrıntı: [research/campus-data.md](research/campus-data.md).
- **Yükseklik:** Copernicus DEM GLO-90, [Open-Meteo yükseklik API'si](https://open-meteo.com/en/docs/elevation-api) üzerinden. Veri CC BY 4.0; ücretsiz API yalnızca ticari olmayan kullanım içindir ve atıf gerektirir. Bu proje ticari değildir; atıf 3B görünümde görünür.
- **Etkinlik içerikleri ve afişleri:** Anadolu Üniversitesi'ne aittir; her kayıt resmî duyuru bağlantısını taşır. İçerikler kopyalanmaz, yalnızca özetlenir ve kaynağa bağlantı verilir. Kaldırılmasını istediğiniz bir kayıt için konu açın.
- **Mekân adları ve plan numaraları:** Üniversitenin [numaralı kampüs planıyla](https://cdn.anadolu.edu.tr/files/anadolu-cms/yxl4j0ed/uploads/map-8cfaf1325315cc4c.pdf) karşılaştırıldı. Plandan gelen işaret koordinatları güvenilir çıkmadığı için konumlar OSM'den alınır.
- Hangi binanın hangi kaynağa dayandığı, hangi yerlerin doğrulanamadığı ve veriyi yeniden üretme adımları: [`research/campus-data.md`](research/campus-data.md).
- Google Earth/Street View verisi kullanılmaz: Google'ın [Map Tiles politikası](https://developers.google.com/maps/documentation/tile/policies) önbelleğe almayı, veri çıkarmayı ve 3D nesnelerin Google verisinden türetilmesini yasaklar.
- Harita adres tarifi vermez; girişler ve yaya yolları sahada doğrulanmadı.

## Veri akışı

- `npm run update:events`, Anadolu Üniversitesinin herkese açık etkinlik listesi ile ayrıntılarını okur ve `public/events.json` dosyasını yazar. Yerel sunucu bunu açılışta ve iki saatte bir dener; GitHub Actions aynı komutu zamanlanmış olarak çalıştırır. İstemci veriyi beş dakikada bir yeniden alır.
- Bir güncelleme başarısız olursa son başarılı kayıt korunur; sayfa veri zamanını gösterir. Her etkinlikte resmî duyuru bağlantısı vardır.
- Yalnızca `data/venues.json` içindeki açıkça eşleşen mekânlara işaret konur. Doğrulanmış bir bina ayak iziyle eşleşmeyen yer (örneğin Kongre Merkezi veya Eğitim Fakültesi) listede kalır, haritaya işaretlenmez ve etkinlik ayrıntısı bunu yazar.

## Katkı

Katkılar memnuniyetle karşılanır; küçük ve odaklı değişiklikler en hızlısıdır. Kurulum, ilkeler ve değişiklik akışı için [CONTRIBUTING.md](CONTRIBUTING.md) dosyasına bakın.

## İlk sürümün sınırları

Etkinlik sayfasının HTML yapısı değişirse ayrıştırıcı güncellenmelidir. `data/venues.json` yeni salonlarla elle genişletilir. Bina yükseklikleri çoğunlukla ayak izi alanından tahmin edilir; yalnızca birkaç binada OSM kat bilgisi vardır. Cihaz WebGL desteklemiyorsa veya hareket azaltma tercihi açıksa sayfa 2B haritayla başlar; 3B görünüm ayrıca seçilebilir. Telefonda çok yakın iki mekânın rozetleri kısmen çakışabilir. Görsel doğrulama için `?debug=grid` adres parametresi ızgara ve etiket bindirmesi ekler; günlük kullanımda etkisi yoktur.
