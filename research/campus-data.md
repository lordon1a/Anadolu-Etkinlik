# Kampüs geometrisi nereden geliyor?

Bu dosya, haritadaki her şeyin hangi kaynağa dayandığını kaydeder. Harita verisi
tek bir üreticiden çıkar: `research/build-campus-data.mjs` → `src/data/campus-geometry.json`.

## Kaynaklar

| Kaynak | Ne için kullanıldı | Durum |
| --- | --- | --- |
| `research/osm-yunus-emre-2026-09-26.osm` — [OSM API](https://api.openstreetmap.org/api/0.6/map?bbox=30.4885,39.7845,30.5105,39.7955) | Kampüs sınırı, bina ayak izleri, yollar, su, yeşil alan, kapı düğümleri | Kullanıldı. Lisans: ODbL 1.0, atıf `© OpenStreetMap contributors` |
| [Esri World Imagery](https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9) (z17 karolar) | 3B sahnede **isteğe bağlı** uydu katmanı | Yalnızca çalışma zamanında, ziyaretçi isterse yüklenir. Karolar depoda ve derlemede yok; tam telif satırı katman açıkken görünür |
| [Open-Meteo yükseklik API'si](https://open-meteo.com/en/docs/elevation-api) (Copernicus DEM GLO-90) | Arazi yükseklik ızgarası (40×40 nokta) | Kullanıldı. Kampüs 791–820 m arasında, 1,8 km'de ~29 m eğim |
| [Üniversitenin numaralı kampüs planı (PDF)](https://cdn.anadolu.edu.tr/files/anadolu-cms/yxl4j0ed/uploads/map-8cfaf1325315cc4c.pdf) | Yer adları ve plan numaraları, kapı adları, salon-bina ilişkileri | Adlar için kullanıldı; **işaret koordinatları güvenilir çıkmadı** (aşağıya bak) |
| Üniversitenin kültür-sanat ve müze sayfaları | Salonların hangi binada olduğu, kapasiteler, bina görünüşü | Doğrulandı, `evidence` alanlarında alıntılandı |
| [OSM telif ve lisans](https://www.openstreetmap.org/copyright) | Atıf ve ODbL koşulları | Sayfa altbilgisinde ve harita altında gösterilir |

Google Earth/Street View verisi **kullanılmadı**: Google'ın [Map Tiles politikası](https://developers.google.com/maps/documentation/tile/policies)
önbelleğe alma, veri çıkarma ve "3D nesnelerin Google verisinden türetilmesi"ni açıkça yasaklıyor.

## Zemin katmanı (stilize çizim + arazi + isteğe bağlı uydu)

```powershell
node research/build-ground-data.mjs   # yükseklik → research/ground/ground.json
                                      # (karşılaştırma karoları → research/ground/tiles, gitignore'lu)
```

- **Varsayılan zemin stilize bir çizimdir** (`src/lib/ground-style.ts`): yeşil alanlar, krem yol şeritleri,
  gölet ve kampüs sınırı, `src/data/campus-geometry.json` içindeki OSM geometrisinden yüksek çözünürlüklü
  bir tuvale çizilir ve `CanvasTexture` olarak DEM yüzeyine giydirilir (mipmap + anizotropik filtre).
  Palet 2B haritanın renk diliyle aynıdır: adaçayı yeşilleri, krem yollar, mavi-yeşil su.
- **Uydu katmanı isteğe bağlıdır:** haritanın köşesindeki **Uydu** düğmesi açıldığında Esri World Imagery
  karoları `src/lib/use-ground-texture.ts` içinde, `ground.json`'daki zoom/kutu/crop hesabıyla doğrudan
  `server.arcgisonline.com` adresinden yüklenir. Yüklenene kadar stilize zemin görünür; hata olursa
  stilizede kalınır ve kısa bir bilgi gösterilir. Tercih `localStorage`'da saklanır.
- Karo dosyaları **depoda ve derleme çıktısında tutulmaz** (`exportTilesAllowed: false`); indirilen yerel
  kopya yalnızca karşılaştırma içindir ve `research/ground/tiles` altında, gitignore'lu durur.
- Yükseklik ızgarası `research/ground/elevation-partial.json` içinde önbelleklenir (API 100 nokta/istek ve
  saatlik kota uygular; yarıda kalan çalışma kaldığı yerden devam eder).
- 3B sahnede zemin **ışıksız** (`MeshBasicMaterial`) çizilir: stilize çizim düz harita renklerini taşır,
  uydu görüntüsü kendi güneşini getirir. Binalar ışıklı malzeme kullanır ve zeminin üstüne gölge düşürür.
- Bina taban kotu, ayak izinin en alçak köşesindeki arazi yüksekliğidir (`groundElevation`), böylece
  eğimli arazide bina havada durmaz.


Üniversitenin `anadolu.ankageo.com/3d/` adresi 26.09.2026'da sanal tur yerine “Jira Raporu”
gösterdi; geometri kaynağı olarak kullanılmadı.

## Lisans durumu

Statik yayında zemin dokusu ve yükseklik verisiyle ilgili koşullar:

- **Esri World Imagery karoları — yeniden dağıtım kaldırıldı.** Servis meta verisi dışa aktarımı
  kapatıyor (`exportTilesAllowed: false`) ve telif satırı “Source: Esri, Vantor, Earthstar Geographics,
  and the GIS User Community”. Önceki sürüm 48 karoyu (0,9 MB) `public/ground/tiles` içinde depoyla
  birlikte yayınlıyordu; bu bir yeniden dağıtım riskiydi. Alınan karar **(a)** seçeneğidir:
  - varsayılan zemin artık OSM geometrisinden çizilen stilize dokudur (`src/lib/ground-style.ts`),
  - uydu görüntüsü **isteğe bağlı** bir katmandır ve yalnızca ziyaretçi isterse, çalışma zamanında
    doğrudan `server.arcgisonline.com` adresinden yüklenir; karo indirilmez, önbelleğe alınmaz,
    derlemeye girmez,
  - katman açıkken haritada servisin **tam telif satırı** görünür:
    “Kaynak: Esri, Vantor, Earthstar Geographics ve GIS kullanıcı topluluğu”.
  Yerel karşılaştırma için indirilen kopyalar `research/ground/tiles` altında durur ve gitignore'ludur.
- **Copernicus DEM GLO-90 (Open-Meteo yükseklik API'si).** Veri CC BY 4.0; ücretsiz API yalnızca
  ticari olmayan kullanım için, atıf zorunlu. Proje ticari değil ve atıf görünür; ticari kullanım
  veya reklam/abonelik eklenirse ücretli API planı gerekir.
- **OpenStreetMap.** ODbL 1.0; atıf haritanın altında ve 3B görünümde görünür, türetilmiş geometri
  dosyaları da ODbL kapsamındadır.

Bu not hukuki görüş değildir; yayına çıkmadan önce ilgili koşulların güncel hali okunmalıdır.

## İzdüşüm

- Yerel metre: **x doğu (+), z güney (+), y yukarı**. Ekranda kuzey yukarıdadır.
- Merkez: sınır poligonunun kutu merkezi `39.7918961, 30.5006767`.
- Ölçek: `111132 m/°` enlem, `85540 m/°` boylam. Koordinatlar tam metreye yuvarlanır.
- Aynı dönüşüm 3B sahne, 2B SVG ve etkinlik pinleri için kullanılır; uygulama hiçbir yerde
  enlem/boylam ölçmez.

## Bina yükseklikleri

| Kaynak | Anlamı |
| --- | --- |
| `osm-height` | OSM `height` etiketi |
| `osm-levels` | OSM `building:levels` × 3,6 m |
| `estimated-from-area` | Kanıt yok; ayak izi alanına göre 4–12 m arası stilize yükseklik |

OSM'de bu kampüste yalnızca birkaç binada kat bilgisi var. Yüksekliği kanıta dayanmayan
binalar `estimated-from-area` olarak işaretlenir ve harita bunu yaklaşık kabul eder.

## Mekân eşleştirmeleri (kanıt)

| Mekân | OSM | Plan no | Kanıt |
| --- | --- | --- | --- |
| AKM | `way/374982336` | 5 | OSM adı eşleşiyor; plandan türetilen nokta 2 m uzakta |
| Öğrenci Merkezi | `way/374982357` | 49 | OSM adı; plandan türetilen nokta 17 m uzakta; resmî sayfa salonları bu binaya veriyor |
| Kütüphane | `way/761605589` | 40 | OSM adı; plan noktası 10 m |
| Sinema Anadolu | `way/374187005` | 54 | OSM adı; plan noktası 18 m. Etkinlik listesindeki “Sinema Anadolu Sokak / Sokağı” da bu mekânın takma adı: binanın önündeki açık hava stant alanı, kendi ayak izi yok, o etkinlikler sinema pinine düşer |
| Çağdaş Sanatlar Müzesi | `way/374986688` | 14 | OSM adı; plan noktası 7 m |
| Eskişehir MYO | `way/660042188` | 24 | OSM adı; plan noktası 6 m |
| Bilişim Teknolojileri MYO | `way/667918876` | – | OSM adı “Bilişim Bloğu” (okul, 4 kat, Anadolu Üniversitesi adresi). Etkinlik listesindeki “Bilişim Teknolojileri Meslek Yüksekokulu Konferans Salonu” bu bloğa bağlandı; planda doğrulanmış numara yok |
| Turizm Fakültesi | `way/374262148` | 61 | OSM adı; plan noktası 13 m |
| Yemekhane / Yeni Yemekhane / Cami | `way/275001635`, `way/1119929972`, `way/718618164` | – | OSM bina etiketi |
| KYK ve Bankamatikler Önü | `way/374982346` | 11 | Yurtların önündeki ATM meydanı (Ziraat ATM `node/10052862752`); planın 11 (ATM gişeleri) ve 39 (KYK yurtları) numaraları bu meydanı ve yurt bloğunu gösteriyor, konum olarak yurt ayak izi kullanılıyor |
| Hukuk Fakültesi | `way/374591223` | 27 | **OSM etiketi hatalı:** ayak izi “Yabancı Diller Yüksekokulu-2” diye adlandırılmış; içindeki `node/11450099269` “Anadolu Üniversitesi Hukuk Fakültesi” (operator: Hukuk Fakültesi Dekanlığı ve Rektörlüğü) ve planın 27 işareti aynı ayak izinin 29 m yakınında. Harita düğümü ve planı izler |
| Eğitim Fakültesi | `relation/5563680` | 22 | OSM çok parçalı relation “Eğitim Fakültesi A - B - C Blok”; plan noktası 15 m uzakta |
| Eczacılık Fakültesi | `relation/5563679` | 18 | OSM relation; planın 18/19 numaraları ve Tepebaşı–Eczacılık Kapısı aynı batı bloğunu gösteriyor |
| Kongre Merkezi | `way/374591227` | 38 | Planın 38 ve 45 (Anadolu Konukevi) numaraları aynı blokta; 38 işareti bu ayak izinin merkezine 22 m uzakta; Lisansüstü Eğitim Enstitüsü resmî iletişim adresi “Kongre Merkezi Binası, Yunus Emre Kampüsü”. OSM ayak izini “Otel Anadolu” diye adlandırıyor (binanın konukevi işlevi), bu yüzden ad etiketi yanıltıcı |

Çok parçalı binalar (`relation`) üreticide dış halkaları birleştirilerek ayak izine çevrilir; iç
avlular yok sayılır.

## Yerleştirilmeyen yerler

| Mekân | Neden |
| --- | --- |
| Salon 2003 / Koral Çalgan (53) | Aynı salonun 2019'da yeniden adlandırıldığı doğrulandı; planın 53 numarası Teknopark'ın kuzeyine düşüyor, orada OSM'de yalnızca isimsiz küçük binalar var. En yakın isimli blok `relation/5563046` (“Yunus Emre Sağlık Hizmetleri Meslek Yüksekokulu”) ama bu kanadın salon olduğu doğrulanamadı → pin çizilmez |

Bu yer etkinlik listesinde kalır ve eşleştirme tablosunda (`data/venues.json`) bulunur;
haritada işaretlenmez. “Sinema Anadolu Sokak” ayrı bir mekân değil, Sinema Anadolu'nun takma
adıdır.

## Kapılar

Dört kapı adı resmî plandan alındı: **Cuma Kapısı, Cumhuriyet Kapısı, Lojmanlar Bölgesi Kapısı,
Tepebaşı–Eczacılık Kapısı**. Konumları OSM düğümlerinden gelir; her biri kampüs dışına çıkan bir
yolun üzerindedir (`evidence` alanında yol kimliği yazılıdır).

Planın çok sayfalı PDF olması nedeniyle işaret koordinatları güvenilir çıkmadı: plan, Cuma Kapısı'nı
kuzey ucda, Lojmanlar Kapısı'nı kuzeydoğuda gösteriyor; OSM verisi bu iki kapıyı güney kenarda
gösteriyor. Harita OSM konumunu kullanır ve plan numarasını yazmaz.

## Doğrulanamayanlar

- Bina kat sayısı, cephe rengi ve mimari biçim: üniversite sayfaları yazmıyor. Tek istisna
  Çağdaş Sanatlar Müzesi (tek katlı, dikdörtgen, sarı-beyaz cephe) ve bu bilgi stile yansıtıldı.
- Kapıların açıldığı cadde adları.
- Ağaçlar: OSM'de tek tek ağaç yok. Orman/park alanlarının içine, bina ve yollardan kaçınarak
  tohumlu (deterministik) dağıtım yapılır; bu sahne süsudur, ölçüm değildir.
- Göletlerin adı ve derinliği.

## Veriyi yeniden üretme

```powershell
node research/build-campus-data.mjs   # OSM → src/data/campus-geometry.json
node research/verify-campus-data.mjs  # özet ve tutarlılık kontrolü
npx vitest run tests/campus.test.ts   # geometri, pin ve eşleştirme testleri
```

OSM verisini güncellemek için `research/osm-yunus-emre-2026-09-26.osm` yerine yeni bir dışa
aktarım koyup üreticiyi çalıştırmak yeterlidir; eşleştirmeler `research/venue-config.mjs`
içindeki kanıt kayıtlarıyla doğrulanır (yanlış `way` kimliği üreticiyi hata ile durdurur).
