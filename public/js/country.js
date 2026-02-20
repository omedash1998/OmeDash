export         async function detectAndSaveCountry(user, db) {
            if (window._countryDetected) return;
            window._countryDetected = true;
            try {
                const res = await fetch('https://ipapi.co/json/');
                const data = await res.json();
                if (data && data.country_code) {
                    const code = data.country_code;
                    const name = data.country_name || code;
                    const emoji = code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
                    const userRef = doc(db, 'users', user.uid);
                    await setDoc(userRef, {
                        countryName: name,
                        countryCode: code,
                        countryEmoji: emoji
                    }, { merge: true });
                    console.log('Country info saved:', code, emoji);
                }
            } catch (err) {
                console.error('Error detecting country:', err);
            }
        }
