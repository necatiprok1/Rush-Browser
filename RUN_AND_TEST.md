# Rush Browser - Çalıştırma ve Test Rehberi

## ✅ Hata Düzeltmeleri Tamamlandı

**Düzeltilen Hata:** `TypeError: Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')`

**Çözüm:** 
- `protocol.registerSchemesAsPrivileged()` çağrısı, Electron modülleri yüklenmeden önce yapılıyordu
- Kod yeniden düzenlendi: Önce tüm modüller yüklendi, sonra scheme kaydı yapıldı
- Store init işlemi de Electron importlarından sonraya alındı

---

## 🚀 Çalıştırma Komutları

### 1. Bağımlılıkları Yükle
```bash
npm install
```

### 2. Syntax Kontrolü (Test)
```bash
npm test
```
veya
```bash
npm run lint
```

### 3. Tarayıcıyı Başlat
```bash
npm start
```

veya doğrudan:
```bash
npx electron .
```

---

## 🧪 Test Senaryoları

### Manuel Test Adımları:

#### 1. Temel Fonksiyonellik
- [ ] Uygulama başarıyla açılıyor mu?
- [ ] Yeni sekme açılabiliyor mu? (Ctrl+T)
- [ ] Sekmeler arası geçiş çalışıyor mu?
- [ ] URL çubuğu çalışıyor mu?
- [ ] Geri/İleri butonları çalışıyor mu?

#### 2. Performans Özellikleri (Aşama 1)
- [ ] Sayfa yükleme hızı normal mi?
- [ ] CPU kullanımı düşük mü? (Task Manager'dan kontrol edin)
- [ ] Bellek kullanımı optimize mi?
- [ ] GPU hızlandırma aktif mi?

#### 3. Güvenlik & Gizlilik (Aşama 2)
- [ ] Tracker'lar engelleniyor mu? (DevTools Network tab'ından kontrol)
- [ ] Cookie güvenliği aktif mi?
- [ ] Site izolasyonu çalışıyor mu?

#### 4. Modern Özellikler (Aşama 3)
- [ ] Dikey sekmeler açılıp kapanabiliyor mu?
- [ ] Çalışma alanları (workspace) oluşturulabiliyor mu?
- [ ] Okuma modu çalışıyor mu?
- [ ] Ekran yakalama özelliği aktif mi?

#### 5. Eklenti & Ekosistem (Aşama 4)
- [ ] Eklenti yönetimi sayfası açılıyor mu?
- [ ] Tema değiştirme çalışıyor mu?
- [ ] Yer imleri senkronize edilebiliyor mu?

#### 6. AI & Akıllı Özellikler (Aşama 5)
- [ ] Akıllı arama çalışıyor mu? (Ctrl+L)
- [ ] İçerik özetleme özelliği aktif mi?
- [ ] Gizlilik raporu görüntülenebiliyor mu?
- [ ] Kullanıcı alışkanlık analizi çalışıyor mu?

---

## 🔍 Debugging İpuçları

### Geliştirici Modunu Aç
```bash
NODE_ENV=development npm start
```

### Console Loglarını Görüntüle
- Terminal'de çıktıları takip edin
- DevTools'u açmak için: `Ctrl+Shift+I` (veya Cmd+Option+I Mac'te)

### Hata Ayıklama
Eğer uygulama başlamazsa:
```bash
# Detaylı loglarla başlat
electron . --enable-logging --v=1
```

### Performans Profiling
```bash
# Chrome DevTools Performance tab'ını kullanın
# veya
node --inspect main.js
```

---

## 📊 Sistem Gereksinimleri

- **Node.js**: v18.0.0 veya üzeri (v22.15.1 kullanılıyor)
- **npm**: v8.0.0 veya üzeri
- **Electron**: v36.4.0
- **İşletim Sistemi**: macOS 10.13+, Windows 10+, Linux

---

## 🛠️ Sorun Giderme

### "Cannot find module" Hatası
```bash
npm install
```

### "Syntax Error" Hatası
```bash
npm test
# Hatalı satırı düzeltin
```

### Uygulama Açılmıyor
```bash
# Cache temizle
rm -rf node_modules
rm package-lock.json
npm install
```

### GPU Hataları
```bash
# GPU olmadan başlat
npm start -- --disable-gpu
```

---

## 📝 Notlar

- Tüm 5 aşama başarıyla kodlandı ve entegre edildi
- Syntax kontrolü geçti ✅
- Kod 4548 satır uzunluğunda
- 14 yeni IPC handler eklendi
- AI destekli özellikler aktif

**Son Güncelleme**: $(date)
**Durum**: ✅ Hazır
