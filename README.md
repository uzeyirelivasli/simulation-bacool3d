# Bacool — şəhər istiliyi və kölgə simulyatoru

Bakının 3D modeli üzərində işləyən şəhərsalma və mikroiqlim platforması (CesiumJS + Vite).
Hazır bina və park modellərini xəritəyə sürükləyib buraxırsınız, saatı dəyişirsiniz və kölgələrin,
temperaturun necə dəyişdiyini görürsünüz.

## Başlamaq
```bash
npm install
npm run dev        # http://localhost:5173
```
İki səhifə var: `http://localhost:5173/` — təqdimat (landing) səhifəsi, `http://localhost:5173/app.html` — simulyator.
Landing səhifəsi tək fayldır (`index.html`), ekran görüntüləri `public/landing/` qovluğundadır.

Node.js 20.19+ tələb olunur. API açarı olmadan da işləyir (ağ şəhər maketi, OpenStreetMap məlumatı ilə).

### Demo üçün: bina məlumatını lokal saxlayın
Açarsız rejimdə real binaların konturları ictimai Overpass API-dən gəlir; o, sorğu limitinə düşə bilər.
Demo-dan əvvəl bir dəfə işə salın:
```bash
npm run snapshot   # public/data/osm-buildings.json faylını yaradır
```
Bu fayl varsa, tətbiq Overpass-a müraciət etmir və internetsiz də açılır. Fayl yoxdursa, məlumat ilk uğurlu
yükləmədən sonra brauzer keşində saxlanır, Overpass isə üç server arasında növbə ilə yoxlanılır.
(Alternativ: brauzer konsolunda `soyuq.exportBuildings()` yüklənmiş məlumatı fayl kimi endirir.)

## İmkanlar

### Model kataloqu (drag-and-drop)
Sol paneldəki **Model kataloqu**ndan kartı xəritəyə sürükləyib buraxın. Sürükləyərkən modelin 3D önbaxışı
(kölgəsi ilə) kursorla birlikdə hərəkət edir.

| Binalar | Parklar |
|---|---|
| Fərdi ev, 5 mərtəbəli blok, 9 mərtəbəli ev, L formalı ev, həyətli məhəllə, 16 mərtəbəli qüllə, podiumlu ofis, pilləli qüllə, ticarət mərkəzi | Cib parkı, dairəvi skver, məhəllə bağı, yaşıl zolaq, orta park, böyük park |

- **Daşımaq:** obyekti seçin, sonra sürükləyin.
- **Fırlatmaq:** `R` / `Shift+R` (15° addımla) və ya sağ paneldə *Fırlanma*.
- **Ölçü:** sağ paneldə *Ölçü, %*; binalar üçün *Mərtəbə sayı* / *Hündürlük* (model proporsional uzanır).
- **Silmək:** `Delete` və ya *Sil* aləti; `Ctrl+Z` / `Ctrl+Y` geri al / təkrarla.
- Kartı sürükləmək əvəzinə ona, sonra xəritəyə klikləmək də olur (trekpad üçün).
- Qeyri-standart forma lazımdırsa, kataloqun sonundakı **Sərbəst bina / Sərbəst park** kartı ilə konturu kliklə çəkin.
- Yollar və tək ağaclar yuxarı alətlər panelindən əlavə olunur.

Modellər `src/catalog.js` faylında təsvir olunub (lokal metrlə konturlar); yeni model əlavə etmək üçün massivə bir sətir yazmaq kifayətdir.

### Real vaxt kölgələri
Aşağı paneldəki **Saat** sürgüsü (06:00–20:00) günəşin mövqeyini dəyişir; ▶ düyməsi günü avtomatik oynadır.
Kölgə salan hər şey nəzərə alınır: xəritədəki real binalar, əlavə etdiyiniz binalar və ağaclar. Kölgələr
yerə, parklara, yollara və digər binaların üzərinə düşür. *Qatlar → Kölgələr* ilə söndürülür.

### İstilik modeli və kursor temperaturu
- **İstilik xəritəsi:** 1 × 1 km aktiv zonada 250 × 250 xanalı (4 m) şəbəkə. Rəng şkalası 10 °C-lik diapazonu əhatə edir (maks. temperatur − 8 … + 2), ona görə 1 °C fərq də aydın seçilir.
- Modelə daxildir: real və əlavə edilmiş binaların dəqiq kölgəsi, ağac kölgəsi və buxarlanma sərinliyi,
  park səthi və onun ətrafa təsiri, yol örtüyünün isinməsi, divar yaxınlığında yığılan istilik.
- **Kursor °C:** siçanı istənilən nöqtəyə gətirəndə həmin nöqtənin temperaturu, günəşdə/kölgədə olması,
  açıq sahədən fərqi və **sizin müdaxilənizin təsiri** (obyektlər olmadan vəziyyətlə müqayisə) göstərilir.
  Binanın üzərində hündürlük və cari kölgə uzunluğu çıxır.
- Statistika: kölgədə olan sahə (%), müdaxilənin orta təsiri, ən sərin nöqtə, sərinləyən sahə (m²).

### Külək
Yuxarıdakı **Külək** panelində 8 sektorlu kompasdan istiqamət (küləyin **haradan** əsdiyi), sürgüdən sürət (0–15 m/s) seçilir;
hazır düymələr: *Sakit*, *Xəzri* (şimal), *Gilavar* (cənub). Kompasın mərkəzi küləyi söndürür.
- **Animasiya:** axın xətləri binaların ətrafından dolanır və sürətə görə rənglənir (mavi = külək kölgəsi, sarı = sərbəst axın,
  narıncı/qırmızı = dar keçidlərdə sürətlənmə). Axın 8 m-lik şəbəkədə potensial axın kimi hesablanır (`src/wind-flow.js`);
  bu, tam CFD deyil, burulğanlar modelləşdirilmir.
- Açıq sahədə külək hiss olunan temperaturu azaldır.
- Binaların arxasında **külək kölgəsi** yaranır: hava durğunlaşır və orada sərinləmə olmur (nisbi xəritədə qırmızı zolaq).
- Park və ağacların sərinliyi külək istiqamətində uzanır.

### Fasad materialları
Bina seçiləndə sağ paneldə *Fasad materialı*: açıq suvaq, əhəngdaşı (aqlay), beton, kərpic, şüşə fasad, yaşıl fasad.
Hər materialın yansıtma (albedo), küçəyə əks olunan istilik və istilik yığımı əmsalı var (`src/config.js` → `editor.materials`).
Günəşli və kölgəli fasadı model günəşin mövqeyinə görə özü ayırır. Açıq və şüşə fasadlar gündüz küçəyə daha çox istilik
əks etdirir; beton və kərpic istiliyi yığıb axşam qaytarır. Xəritədəki real binalar beton kimi qəbul edilir.

### Mütləq / nisbi rejim və "əvvəl → indi"
- **Mütləq °C:** hər nöqtənin temperaturu.
- **Nisbi Δ:** yalnız sizin əlavə etdiyiniz obyektlərin yaratdığı fərq (mavi = sərinlədi, qırmızı = isindi).
- Kursor altında **Əvvəl → indi** (məs. 40.0 → 37.0 °C) göstərilir. Binanın üzərində dam, günəşli və kölgəli fasad
  temperaturu, material və binanın ətrafında (12 m) orta temperaturun əvvəl → indi dəyəri çıxır.

> Model sadələşdirilmiş demo modelidir: əmsallar təxmini qiymətlərdir, real ölçmə deyil.
> Təmsilçi gün: 15 iyul (`src/config.js` → `time.representativeDate`).

## Xəritə rejimləri
| Rejim | Şərt | Görüntü |
|---|---|---|
| Ağ şəhər maketi (OSM) | heç bir açar lazım deyil | Overpass konturlarından ekstruziya — **demo üçün tövsiyə olunur** |
| OSM 3D Binalar (ion) | `VITE_CESIUM_ION_TOKEN` | Cesium OSM Buildings + dünya relyefi |
| Google Fotorealistik 3D | `VITE_GOOGLE_MAPS_API_KEY` | Fotorealistik şəhər |

Açarlar `.env.local` faylına yazılır (`cp .env.example .env.local`). Google üçün Cloud Console-da billing və
Map Tiles API aktiv olmalı, açar HTTP referrer (`http://localhost:5173/*`) ilə məhdudlaşdırılmalıdır.

Google və ion rejimlərində bina konturları istilik modeli üçün fonda OSM-dən ayrıca yüklənir. Qeyd: Google
taylarının teksturasında çəkiliş vaxtının kölgələri artıq var, ona görə saat dəyişəndə iki kölgə üst-üstə
düşə bilər; kölgə simulyasiyası ağ maket rejimində ən aydın görünür. Yeni funksiyalar açarsız rejimdə
yoxlanılıb, Google və ion rejimlərində sınaqdan keçirilməyib.

## Layihə quruluşu
| Fayl | Vəzifə |
|---|---|
| `src/main.js` | Başlanğıc: viewer, kölgə ayarları, modulların birləşdirilməsi |
| `src/city-environment.js` | Şəhər rejimləri, bina konturlarının yüklənməsi (snapshot → keş → Overpass) |
| `src/catalog.js`, `src/catalog-ui.js` | Model kataloqu, miniatürlər, drag-and-drop |
| `src/editor.js`, `src/editor-ui.js` | Alətlər, yerləşdirmə, daşıma, fırlatma, xüsusiyyətlər paneli |
| `src/transform.js` | Həndəsə çevrilmələri (daşıma, fırlatma, miqyas) |
| `src/building-renderer.js`, `src/surface-renderer.js`, `src/tree-renderer.js` | 3D render |
| `src/heatmap.js` | Mikroiqlim modeli, istilik qatı, külək paneli, kursor temperaturu |
| `src/wind-flow.js` | Külək axınının hesablanması və animasiyası |
| `src/theme.css` | Qara-ağ interfeys mövzusu |
| `src/object-store.js`, `src/persistence.js` | Obyekt modeli, geri al/təkrarla, IndexedDB yaddaşı |
| `scripts/fetch-osm.mjs` | Bina məlumatının lokal snapshot-u |

## Koordinat sistemi
Mənşə: 40.4093° N, 49.8671° E. `x` = Şərq, `y` = Şimal, `z` = Yuxarı (metr). Konsolda yoxlama: `soyuq.geo.localToLonLat(500, 500)`.

## Məhdudiyyətlər
- Obyektlər yalnız 1 × 1 km aktiv dizayn zonasına yerləşdirilir.
- Real binaların hündürlüyü OSM teqlərindən götürülür; teq yoxdursa 12 m qəbul edilir.
- Açarsız rejimdə yer düz qəbul olunur (relyef yoxdur).
- Google tayllarında binalar teksturalı mesh-dir; ayrı-ayrı obyekt kimi redaktə edilə bilməz.
- Google/üçüncü tərəf atribusiyaları gizlədilmir; tayllar diskə yazılmır.
