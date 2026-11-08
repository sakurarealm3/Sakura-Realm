/* Sakura Realm - Myanmar language pack.
   This is the ONLY file you edit to add Myanmar words for new features.  (engine: i18n.js, must be loaded AFTER this file)
   Not sure which texts are still missing?  Open the site, switch to မြန်မာ, then in the browser console run:  SakuraI18n.exportMissing()
   It prints every English text that has no translation yet, as ready-to-paste lines for D below. */
(function () {
    'use strict';
    // ------------------------------------------------------------------ dictionary (English -> မြန်မာ)
    // HOW TO ADD NEW WORDS: put a new line  'English text': 'မြန်မာစာ',  in D below. The text must match the English on the page exactly
    // (upper/lower case does not matter). Text with a number or name inside goes in P (patterns) further down.
    var D = {
        /* header / search */
        /* adult content */
        'Adult Content': 'အရွယ်ရောက်ပြီးသူ အကြောင်းအရာ',
        'This section contains mature manga made for adults only. Only adult manga will be shown and the normal manga will be hidden.': 'ဤအပိုင်းတွင် အရွယ်ရောက်ပြီးသူများအတွက်သာ ရည်ရွယ်သော မန်ဂါများ ပါဝင်သည်။ အရွယ်ရောက်ပြီးသူ မန်ဂါများကိုသာ ပြပြီး ပုံမှန်မန်ဂါများကို ဖျောက်ထားမည်။',
        'Are you 18 years or older?': 'သင် အသက် ၁၈ နှစ် ပြည့်ပြီလား?', 'I am 18 or older': 'ကျွန်ုပ် အသက် ၁၈ နှစ် ပြည့်ပြီ',
        'Adult Content (18+)': 'အရွယ်ရောက်ပြီးသူ အကြောင်းအရာ (၁၈+)', 'Show adult manga only and hide the normal manga': 'အရွယ်ရောက်ပြီးသူ မန်ဂါများကိုသာ ပြပြီး ပုံမှန်မန်ဂါများကို ဖျောက်ထားမည်',
        'Adult Content on - showing 18+ manga only': 'Adult Content ဖွင့်ထားသည် - ၁၈+ မန်ဂါများသာ ပြနေသည်', 'Adult Content off': 'Adult Content ပိတ်ထားသည်',
        'Jelly Touch': 'ဂျယ်လီ ထိတွေ့မှု', 'Home and History pictures wobble like jelly when touched': 'ထိလိုက်လျှင် ပင်မနှင့် မှတ်တမ်းစာမျက်နှာရှိ ပုံများ ဂျယ်လီကဲ့သို့ လှုပ်ခါမည်',
        'Jelly Touch on': 'Jelly Touch ဖွင့်ထားသည်', 'Jelly Touch off': 'Jelly Touch ပိတ်ထားသည်',
        'Battery Saving': 'ဘက်ထရီ ချွေတာမုဒ်', 'Manga Detail': 'မန်ဂါ အသေးစိတ်',
        'Could not save offline (storage full or private mode)': 'ဒေါင်းလုဒ် သိမ်း၍မရပါ (သိုလှောင်ခန်း ပြည့်နေသည် သို့မဟုတ် private mode ဖြစ်နေသည်)',
        'Search': 'ရှာဖွေရန်', 'Colour Theme': 'အရောင်အသွေး ပုံစံ', 'Menu': 'မီနူး',
        'Search manga titles...': 'မန်ဂါ အမည်များ ရှာဖွေပါ...', 'Search manga titles': 'မန်ဂါ အမည်များ ရှာဖွေပါ',
        'Clear text': 'စာသား ဖျက်ရန်', 'Cancel': 'ပယ်ဖျက်', 'Close': 'ပိတ်ရန်',
        'Recent searches': 'မကြာသေးမီ ရှာဖွေမှုများ', 'Clear all': 'အားလုံး ရှင်းရန်',
        'Manga you search for will be remembered here': 'သင်ရှာဖွေသော မန်ဂါများကို ဤနေရာတွင် မှတ်ထားပါမည်',
        'Results': 'ရလဒ်များ', 'Remove from recent': 'မှတ်တမ်းမှ ဖယ်ရှားရန်',
        'No Manga found desu~': 'မန်ဂါ မတွေ့ပါ',
        /* reader */
        'Back to Chapter Lobby': 'အခန်းစာရင်းသို့ ပြန်ရန်', 'Chapter Reading': 'အခန်း ဖတ်ရှုနေသည်',
        'Reading Settings': 'ဖတ်ရှုမှု ဆက်တင်', 'Reader Settings': 'ဖတ်ရှုသူ ဆက်တင်',
        'Reading Mode': 'ဖတ်ရှုပုံစံ', 'Scrolling': 'အောက်သို့ ဆွဲဖတ်', 'Page by Page': 'စာမျက်နှာ တစ်ခုချင်း',
        'Image Quality': 'ပုံ အရည်အသွေး', 'Low (480p)': 'နိမ့် (480p)', 'Medium (720p)': 'အလတ် (720p)', 'High (Original)': 'မြင့် (မူရင်း)',
        'LOADING': 'ဖွင့်နေသည်', 'Failed to load': 'မဖွင့်နိုင်ပါ', 'Tap to retry': 'ပြန်ကြိုးစားရန် နှိပ်ပါ',
        'CHAPTERS': 'အခန်းများ', 'Chapters': 'အခန်းများ', 'Back Chapter': 'ယခင်အခန်း', 'Next Chapter': 'နောက်အခန်း',
        /* filter */
        'Filter Collection': 'စုစည်းမှုကို စစ်ထုတ်ရန်', 'Release Timeline': 'ထုတ်ဝေချိန်', 'All': 'အားလုံး',
        'New Release': 'ထုတ်ဝေ အသစ်', 'Old Release': 'ထုတ်ဝေ အဟောင်း',
        'Genres Type (Multi-Select)': 'အမျိုးအစား (အများရွေးနိုင်)', 'Clear Genres': 'ရှင်းလင်းရန်',
        'Apply Filter': 'စစ်ထုတ်ရန်', 'Filter': 'စစ်ထုတ်',
        /* sidebar / home */
        'Menu Navigation': 'မီနူး', 'Welcome To Sakura Realm': 'Sakura Realm မှ ကြိုဆိုပါသည်',
        'Account Login': 'အကောင့်ဝင်ရန်', 'Sign in to unlock premium chapters': 'Premium chapter များကို ဖွင့်ရန် အကောင့်ဝင်ပါ', 'Login': 'ဝင်မည်', 'Signing in...': 'ဝင်နေသည်...',
        'Accounts are issued by the admin': 'အကောင့်ကို admin က ထုတ်ပေးပါသည်', 'Remember me': 'ကျွန်ုပ်ကို မှတ်ထားပါ', 'Logout': 'ထွက်မည်', 'Your Coins': 'သင့် Coins', 'Member Plan': 'Member Plan', 'Active': 'အသုံးပြုနိုင်', 'Not Active': 'သက်တမ်းကုန်',
        'Welcome to Sakura Realm': 'Sakura Realm မှ ကြိုဆိုပါသည်',
        'HOT TRENDING SHOWCASE': 'လူကြိုက်အများဆုံး', 'LATEST UPDATE': 'နောက်ဆုံးအပ်ဒိတ်', 'UPDATE': 'အပ်ဒိတ်',
        'Open Latest Updates': 'နောက်ဆုံး အပ်ဒိတ်များ ဖွင့်ရန်',
        'MAIN MANGA COLLECTION': 'မန်ဂါ စုစည်းမှု', 'Latest Updates': 'နောက်ဆုံး အပ်ဒိတ်များ',
        'Newest chapters first desu~': 'အသစ်ဆုံး အခန်းများ အရင်ပြသည်',
        'Latest updates will appear here desu~': 'နောက်ဆုံး အပ်ဒိတ်များကို ဤနေရာတွင် မြင်ရပါမည်',
        'Browse Genres': 'အမျိုးအစားများ ကြည့်ရန်', 'Pick a genre to filter desu~': 'စစ်ထုတ်လိုသော အမျိုးအစားကို ရွေးပါ',
        'NEW': 'အသစ်', 'New': 'အသစ်', 'New Ch': 'အခန်းသစ်', 'NEW MANGA': 'မန်ဂါသစ်', 'NEW CHAPTER': 'အခန်းသစ်', 'CH': 'အခန်း',
        'New upload': 'အသစ်တင်', 'new upload': 'အသစ်တင်', 'just now': 'ယခုလေးတင်',
        /* detail */
        'Back to Home': 'ပင်မစာမျက်နှာသို့', 'Manga': 'မန်ဂါ', 'Manga Title': 'မန်ဂါ အမည်', 'Genres Type': 'အမျိုးအစား',
        'Rating': 'အဆင့်သတ်မှတ်ချက်', 'Add to Bookmark': 'မှတ်ထားရန်', 'Bookmarked': 'မှတ်ထားပြီး',
        'First Read': 'ပထမဆုံး ဖတ်ရန်', 'Description': 'အကြောင်းအရာ',
        'Cinematic Manga Experience desu~': 'ရုပ်ရှင်ဆန်သော မန်ဂါ အတွေ့အကြုံ',
        'No description available desu~': 'အကြောင်းအရာ မရှိသေးပါ',
        'Chapter List': 'အခန်းစာရင်း', 'Newest': 'အသစ်ဆုံး', 'Oldest': 'အဟောင်း',
        'Change order': 'အစီအစဉ် ပြောင်းရန်', 'Switch layout': 'ဖော်ပြပုံ ပြောင်းရန်',
        'Newest first - tap for Oldest first': 'အသစ်ဆုံးအရင် - နှိပ်၍ အဟောင်းဆုံးအရင် ပြောင်းရန်',
        'Oldest first - tap for Newest first': 'အဟောင်းဆုံးအရင် - နှိပ်၍ အသစ်ဆုံးအရင် ပြောင်းရန်',
        'Show as blocks': 'ကွက်ပုံစံ ပြရန်', 'Show as list': 'စာရင်းပုံစံ ပြရန်', 'Show more': 'ပိုမိုပြရန်',
        'Recent': 'မကြာမီ', 'Recent Release': 'မကြာသေးမီ ထုတ်ဝေ',
        'Ongoing': 'ထုတ်ဝေဆဲ', 'Completed': 'ပြီးဆုံး', 'Hiatus': 'ခေတ္တနား', 'Dropped': 'ရပ်ထား',
        'Manhwa': 'မန်ဝါ', 'Manhua': 'မန်ဟွာ',
        /* genres */
        'Action': 'အက်ရှင်', 'Adventure': 'စွန့်စားခန်း', 'Comedy': 'ဟာသ', 'Drama': 'ဒရာမာ', 'Fantasy': 'ဖန်တာစီ',
        'Horror': 'ထိတ်လန့်ဖွယ်', 'Romance': 'အချစ်ရေး', 'Slice of Life': 'နေ့စဉ်ဘဝ', 'Sci-Fi': 'သိပ္ပံစိတ်ကူးယဉ်',
        'Mystery': 'လျှို့ဝှက်ဆန်းကြယ်', 'Supernatural': 'သဘာဝလွန်', 'School Life': 'ကျောင်းသားဘဝ', 'School': 'ကျောင်း',
        'Psychological': 'စိတ်ပိုင်းဆိုင်ရာ', 'Sports': 'အားကစား', 'Thriller': 'စိတ်လှုပ်ရှားဖွယ်', 'Historical': 'သမိုင်းဆိုင်ရာ',
        'Martial Arts': 'ကိုယ်ခံပညာ', 'Isekai': 'ဣဇေကိုင်း', 'Tragedy': 'ဝမ်းနည်းဖွယ်', 'Music': 'ဂီတ', 'Magic': 'မှော်ပညာ',
        'Mecha': 'စက်ရုပ်', 'Crime': 'ရာဇဝတ်မှု', 'Detective': 'စုံထောက်', 'Gore': 'သွေးထွက်သံယိုမှု', 'Ecchi': 'အက်ချိ',
        'Harem': 'ဟားရမ်', 'Shounen': 'ရှောင်နင်း', 'Shoujo': 'ရှောဂျို', 'Seinen': 'ဆိုင်နင်း', 'Josei': 'ဂျိုဆိုင်း',
        'Mature': 'လူကြီးအတွက်', 'Demons': 'နတ်ဆိုး', 'Vampire': 'သွေးစုတ်ဖုတ်ကောင်', 'Military': 'စစ်ရေး', 'Game': 'ဂိမ်း',
        /* bookmark / history / dock */
        'Bookmark': 'မှတ်ထား', 'History': 'မှတ်တမ်း', 'Setting': 'ဆက်တင်', 'Quick menu': 'အမြန် မီနူး',
        'No bookmarks yet': 'မှတ်ထားသည်များ မရှိသေးပါ', 'Remove bookmark': 'မှတ်ထားမှု ဖယ်ရှားရန်',
        'Latest Reading': 'နောက်ဆုံး ဖတ်ခဲ့သည်', 'Nothing read yet': 'မဖတ်ရသေးပါ',
        'Download Management': 'ဒေါင်းလုဒ် စီမံခန့်ခွဲမှု', 'No downloads yet': 'ဒေါင်းလုဒ် မရှိသေးပါ',
        /* downloads */
        'Download': 'ဒေါင်းလုဒ်', 'Downloading': 'ဒေါင်းလုဒ်လုပ်နေသည်', 'Downloading...': 'ဒေါင်းလုဒ်လုပ်နေသည်...',
        'Downloaded': 'ဒေါင်းလုဒ်ပြီး', 'Downloading Done': 'ဒေါင်းလုဒ် ပြီးစီးပါပြီ', 'Failed': 'မအောင်မြင်ပါ',
        'Retry': 'ပြန်ကြိုးစားရန်', 'Remove': 'ဖယ်ရှားရန်', 'Chapter already downloaded': 'ဤအခန်းကို ဒေါင်းလုဒ်လုပ်ပြီးသားဖြစ်သည်',
        'Downloaded - remove it in History to download again': 'ဒေါင်းလုဒ်ပြီး - ထပ်ဒေါင်းရန် မှတ်တမ်းတွင် ဖယ်ရှားပါ',
        'Chapter data not available yet': 'အခန်းဒေတာ မရသေးပါ',
        /* settings page */
        'Data Storage Manager': 'ဒေတာ သိမ်းဆည်းမှု စီမံခန့်ခွဲမှု', 'Data Storage': 'ဒေတာ သိမ်းဆည်းမှု',
        'used by this site': 'ဤဝဘ်ဆိုက်မှ အသုံးပြုထားသည်', 'Downloaded chapters': 'ဒေါင်းလုဒ်လုပ်ထားသော အခန်းများ',
        'Cache data': 'ကက်ရှ် ဒေတာ', 'Clear All Data': 'ဒေတာအားလုံး ရှင်းရန်', 'Clear Cache': 'ကက်ရှ် ရှင်းရန်',
        'Downloaded chapters = pages saved for offline reading. Cache data = saved app files (fonts, libraries).':
            'ဒေါင်းလုဒ်လုပ်ထားသော အခန်းများ = အော့ဖ်လိုင်း ဖတ်ရန် သိမ်းထားသော စာမျက်နှာများ။ ကက်ရှ်ဒေတာ = သိမ်းထားသော အက်ပ်ဖိုင်များ (ဖောင့်၊ ပရိုဂရမ်စာကြည့်တိုက်များ)။',
        'Setting Management': 'ဆက်တင် စီမံခန့်ခွဲမှု', 'User Setting': 'အသုံးပြုသူ ဆက်တင်',
        'Language': 'ဘာသာစကား', 'Choose the display language': 'ပြသမည့် ဘာသာစကားကို ရွေးပါ',
        'Auto Download': 'အလိုအလျောက် ဒေါင်းလုဒ်', 'Save the chapter you are reading for offline': 'ဖတ်နေသော အခန်းကို အော့ဖ်လိုင်းဖတ်ရန် သိမ်းထားမည်',
        'Keep Screen On': 'မျက်နှာပြင် ဖွင့်ထားရန်', 'Screen stays awake while reading': 'ဖတ်နေစဉ် မျက်နှာပြင် မပိတ်စေရန်',
        'Low-end Mode': 'စက်အနိမ့်စား မုဒ်', 'Smoother on slow phones: no blur, no petals, light animations': 'နှေးသော ဖုန်းများတွင် ပိုချောမွေ့သည် - ဝါးမှုန်းမှု၊ ပန်းပွင့်ဖတ်များ မပါ၊ အန်နီမေးရှင်း ပေါ့ပါးသည်',
        'Battery Saver': 'ဘက်ထရီ ချွေတာမုဒ်', 'Fewer animations, less battery use': 'အန်နီမေးရှင်း လျော့နည်း၊ ဘက်ထရီ သက်သာသည်',
        'Keep Screen On is not supported in this browser': 'ဤဘရောက်ဇာတွင် "မျက်နှာပြင် ဖွင့်ထားရန်" ကို မထောက်ပံ့ပါ',
        'Low-end Mode on - lighter animations': 'စက်အနိမ့်စား မုဒ် ဖွင့်ပြီး - အန်နီမေးရှင်း ပေါ့ပါးသည်',
        'About & Legal': 'အကြောင်းအရာနှင့် ဥပဒေ', 'Terms of Service': 'ဝန်ဆောင်မှု စည်းမျဉ်းများ',
        'Rules for using Sakura Realm': 'Sakura Realm အသုံးပြုရန် စည်းကမ်းများ', 'Privacy Policy': 'ကိုယ်ရေးအချက်အလက် မူဝါဒ',
        'What is stored and what is shared': 'ဘာတွေ သိမ်းထားပြီး ဘာတွေ မျှဝေသည်ကို ဖော်ပြသည်',
        'Terms': 'စည်းမျဉ်းများ', '· All manga belong to their respective owners.': '· မန်ဂါအားလုံးသည် မူပိုင်ရှင်များ၏ ပိုင်ဆိုင်မှု ဖြစ်သည်။',
        /* confirm / toasts */
        'Clear?': 'ရှင်းမလား?', 'Confirm': 'အတည်ပြုရန်', 'Clear Cache?': 'ကက်ရှ် ရှင်းမလား?', 'Clear All Data?': 'ဒေတာအားလုံး ရှင်းမလား?',
        'Clear All': 'အားလုံး ရှင်းရန်',
        'Saved app files (fonts, libraries) will be removed. Your downloads, bookmarks and history stay safe. The app needs internet once to work offline again.':
            'သိမ်းထားသော အက်ပ်ဖိုင်များ (ဖောင့်၊ စာကြည့်တိုက်များ) ကို ဖယ်ရှားမည်။ သင်၏ ဒေါင်းလုဒ်များ၊ မှတ်ထားသည်များနှင့် မှတ်တမ်းတို့ ဆက်လက်ရှိနေမည်။ အော့ဖ်လိုင်း ပြန်သုံးရန် အင်တာနက် တစ်ကြိမ် လိုအပ်ပါမည်။',
        'Downloaded chapters, bookmarks, reading history and settings on this device will be deleted. This cannot be undone.':
            'ဤစက်ရှိ ဒေါင်းလုဒ်လုပ်ထားသော အခန်းများ၊ မှတ်ထားသည်များ၊ ဖတ်ရှုမှတ်တမ်းနှင့် ဆက်တင်များ အားလုံး ပျက်သွားမည်။ ပြန်လည်ရယူ၍ မရပါ။',
        'Cache cleared': 'ကက်ရှ် ရှင်းလင်းပြီးပါပြီ', 'Could not clear cache': 'ကက်ရှ် ရှင်း၍ မရပါ',
        'All data cleared': 'ဒေတာအားလုံး ရှင်းလင်းပြီးပါပြီ', 'Could not clear everything': 'အားလုံး ရှင်း၍ မရပါ',
        /* themes */
        'Sakura Teal': 'ဆာကူရာ စိမ်းပြာ', 'Rose': 'နှင်းဆီ', 'Violet': 'ခရမ်း', 'Amber': 'ပယင်းရောင်', 'Aurora': 'အော်ရိုရာ', 'Sunset': 'နေဝင်ချိန်',
        'Sakura Realm ©': 'Sakura Realm ©',
        'Original': 'မူရင်း', 'Blend': 'ရောစပ်'
    };

    // ------------------------------------------------------------------ patterns (text with numbers / names inside)
    var P = [
        [/^(\d+)m ago$/, function (m) { return m[1] + ' မိနစ်က'; }],
        [/^(\d+)h ago$/, function (m) { return m[1] + ' နာရီက'; }],
        [/^(\d+)d ago$/, function (m) { return m[1] + ' ရက်က'; }],
        [/^Chapter\s*(\d[\w.\-]*)(.*)$/i, function (m) { return 'အခန်း ' + m[1] + m[2]; }],
        [/^Ch\.?\s*(\d[\w.\-]*)$/i, function (m) { return 'အခန်း ' + m[1]; }],
        [/^Episode\s*(\d[\w.\-]*)$/i, function (m) { return 'ဇာတ်လမ်းအပိုင်း ' + m[1]; }],
        [/^(\d+) chapters? downloaded$/, function (m) { return 'ဒေါင်းလုဒ်လုပ်ထားသော အခန်း ' + m[1] + ' ခု'; }],
        [/^Read up to (.+)$/, function (m, t) { return t(m[1]) + ' အထိ ဖတ်ပြီး'; }],
        [/^Download failed: (.+)$/, function (m, t) { return 'ဒေါင်းလုဒ် မအောင်မြင်ပါ: ' + t(m[1]); }],
        [/^No pages to download in (.+)$/, function (m, t) { return t(m[1]) + ' တွင် ဒေါင်းလုဒ်လုပ်ရန် စာမျက်နှာ မရှိပါ'; }],
        [/^Download (.+)$/, function (m, t) { return t(m[1]) + ' ကို ဒေါင်းလုဒ်လုပ်ရန်'; }],
        [/^Show update (\d+)$/, function (m) { return 'အပ်ဒိတ် ' + m[1] + ' ကို ပြရန်'; }],
        [/^HOT #(\d+)$/, function (m) { return 'ဟော့ #' + m[1]; }],
        [/^No manga found for “(.*)”$/, function (m) { return '“' + m[1] + '” အတွက် မန်ဂါ မတွေ့ပါ'; }],
        [/^\+(\d+) more shown on Home$/, function (m) { return '+' + m[1] + ' ခု ပင်မစာမျက်နှာတွင် ပြထားသည်'; }],
        [/^(.+?)\s+·\s+Offline$/, function (m, t) { return t(m[1]) + ' · အော့ဖ်လိုင်း'; }],
        [/^(.+?) - (New Ch|new upload|New upload)$/, function (m, t) { return m[1] + ' - ' + t(m[2]); }]
    ];

    // ------------------------------------------------------------------ Terms / Privacy in Myanmar
    window.LEGAL_DOCS_MY = {
        updated: 'နောက်ဆုံး ပြင်ဆင်သည့်ရက် - ၂၀၂၆ ခုနှစ်၊ နိုဝင်ဘာ ၅ ရက်',
        terms: {
            icon: 'fa-file-contract', title: 'ဝန်ဆောင်မှု စည်းမျဉ်းများ', intro: '',
            sections: [
                ['၁။ ဝန်ဆောင်မှုအကြောင်း', ['Sakura Realm သည် မန်ဂါများကို အွန်လိုင်းနှင့် အော့ဖ်လိုင်း ဖတ်ရှုနိုင်သော ဝဘ်ဆိုက်ဖြစ်သည်။ လက်ရှိတွင် အခမဲ့ အသုံးပြုနိုင်သော်လည်း အနာဂတ်တွင် ဈေးနှုန်း သို့မဟုတ် အသင်းဝင်စနစ်များ ထည့်သွင်းနိုင်ပါသည်။ သင်၏ ဖတ်ရှုမှု တိုးတက်မှု၊ မှတ်တမ်းနှင့် ဆက်တင်များကို သင့်စက်ထဲတွင်သာ သိမ်းဆည်းထားပါသည်။']],
                ['၂။ အသုံးပြုရန် စည်းကမ်းများ', ['ဤဝဘ်ဆိုက်ကို သင်ကိုယ်တိုင် ဖတ်ရှုရန်အတွက်သာ (စီးပွားဖြစ် မဟုတ်ဘဲ) အသုံးပြုနိုင်သည်။ အခန်းများကို ဒေါင်းလုဒ်လုပ်ပြီး အခြားနေရာတွင် မျှဝေခြင်း၊ ရောင်းချခြင်း သို့မဟုတ် ပြန်လည်တင်ခြင်း မပြုလုပ်ရပါ။']],
                ['၃။ မူပိုင်ခွင့်နှင့် ဖယ်ရှားမှု', ['မန်ဂါများ၊ ဖုံးများ၊ ခေါင်းစဉ်များ၊ ဇာတ်ကောင်များနှင့် ပန်းချီလက်ရာအားလုံးသည် သက်ဆိုင်ရာ ရေးသားသူများ၊ ပန်းချီဆရာများနှင့် ထုတ်ဝေသူများ၏ ပိုင်ဆိုင်မှု ဖြစ်သည်။ Sakura Realm သည် ၎င်းတို့ကို ပိုင်ဆိုင်ကြောင်း မဆိုပါ။ သက်ဆိုင်ရာ မူပိုင်ခွင့်ရှင်များက တောင်းဆိုပါက တောင်းဆိုထားသော မန်ဂါကို ဝဘ်ဆိုက်မှ ချက်ချင်း ဖယ်ရှားပေးပါမည်။']],
                ['၄။ အကြောင်းအရာနှင့် အသက်အရွယ်', ['အချို့သော မန်ဂါများတွင် လူကြီးအတွက် ဖြစ်သော အကြောင်းအရာများ ပါဝင်နိုင်သည်။ မိမိနှင့် သင့်တော်မှုရှိမရှိကို မိမိကိုယ်တိုင် ဆုံးဖြတ်ရန် တာဝန်ရှိသည်။ အသက်မပြည့်သေးပါက မိဘ သို့မဟုတ် အုပ်ထိန်းသူနှင့်အတူ အသုံးပြုပါ။']],
                ['၅။ ဝဘ်ဆိုက် ပြောင်းလဲမှုများ', ['မန်ဂါများကို ကြိုတင်အသိပေးခြင်းမရှိဘဲ ထည့်သွင်းခြင်း သို့မဟုတ် ဖယ်ရှားခြင်း ပြုလုပ်နိုင်ပြီး ဝဘ်ဆိုက်ကိုလည်း မည်သည့်အချိန်တွင်မဆို ပြောင်းလဲခြင်း၊ အပ်ဒိတ်လုပ်ခြင်း သို့မဟုတ် ခေတ္တရပ်နားခြင်း ပြုလုပ်နိုင်သည်။']],
                ['၆။ တာဝန်ယူမှု ကန့်သတ်ချက်', ['ဤဝဘ်ဆိုက်ကို “ရှိသည့်အတိုင်း” နှင့် “ရနိုင်သလောက်” အခြေခံဖြင့် မည်သည့် အာမခံချက်မျှ မပါဘဲ ပေးထားခြင်း ဖြစ်သည်။ ဝဘ်ဆိုက် အသုံးပြုမှုကြောင့် ဖြစ်ပေါ်လာသော ဒေတာ ဆုံးရှုံးမှု၊ ပျက်စီးမှု သို့မဟုတ် ပြဿနာများအတွက် ဝဘ်ဆိုက် လုပ်ကိုင်သူသည် တာဝန်မယူပါ။']]
            ]
        },
        privacy: {
            icon: 'fa-user-shield', title: 'ကိုယ်ရေးအချက်အလက် မူဝါဒ', intro: '',
            sections: [
                ['၁။ ကျွန်ုပ်တို့ စုဆောင်းသော အချက်အလက်များ', [
                    '<b>အကောင့် အချက်အလက်:</b> အနာဂတ်တွင် အကောင့်နှင့် အခပေး အသင်းဝင်စနစ်များ ထည့်သွင်းပါက အကောင့်ဖွင့်ရန် လိုအပ်သော အီးမေးလ်၊ စကားဝှက်နှင့် အသင်းဝင်ကာလ အချက်အလက်များကို စုဆောင်းပါမည်။',
                    '<b>သင့်စက်ထဲတွင် သိမ်းဆည်းသော ဒေတာ:</b> သင်၏ မှတ်ထားသည်များ၊ ဖတ်ရှုမှတ်တမ်း၊ ဒေါင်းလုဒ်လုပ်ထားသော မန်ဂါများနှင့် ဆက်တင်များကို သင့်စက်ထဲတွင်သာ (Local Storage နှင့် IndexedDB) သိမ်းဆည်းထားပါသည်။']],
                ['၂။ သင့်ဒေတာကို မည်သို့ အသုံးပြုသနည်း', ['သင့်ဒေတာကို အကောင့်ဝင်ခြင်း အတည်ပြုရန်၊ အသင်းဝင်ကာလ စီမံရန်နှင့် ဝဘ်ဆိုက်တွင် မန်ဂါ ဖတ်ရှုနိုင်ရန်အတွက်သာ အသုံးပြုပါသည်။ သင့်ကိုယ်ရေးအချက်အလက်ကို ကြော်ငြာအတွက် မည်သည့်အခါမျှ အသုံးမပြုပါ၊ အခြားသူများထံလည်း မည်သည့်အခါမျှ မရောင်းချပါ။']],
                ['၃။ ပြင်ပ ဝန်ဆောင်မှုများ', ['ဝဘ်ဆိုက်နှင့် မန်ဂါပုံများ ပုံမှန်အလုပ်လုပ်စေရန် Google Firebase၊ CDN များနှင့် ပုံ Host များသို့ ချိတ်ဆက်ထားပါသည်။ ထို့ကြောင့် ဤဝန်ဆောင်မှုများသည် သင့် IP လိပ်စာကို မြင်နိုင်ပါသည်။']],
                ['၄။ ဒေတာ ထိန်းချုပ်မှုနှင့် လုံခြုံရေး', ['သင့်စက်ထဲရှိ ဒေတာများကို ဆက်တင်မှ မည်သည့်အချိန်တွင်မဆို ရှင်းလင်းနိုင်သည်။ အကောင့် အချက်အလက်များကို လုံခြုံသော စနစ် (HTTPS) ဖြင့် ကာကွယ်ထားပါမည်။']],
                ['၅။ ဤမူဝါဒ၏ ပြောင်းလဲမှုများ', ['ကျွန်ုပ်တို့၏ ဝန်ဆောင်မှုများ သို့မဟုတ် ဒေတာ ကိုင်တွယ်ပုံ ပြောင်းလဲပါက ရက်စွဲနှင့်အတူ ဤကိုယ်ရေးအချက်အလက် မူဝါဒ စာမျက်နှာကို အပ်ဒိတ်လုပ်ပါမည်။']]
            ]
        }
    };

    window.SakuraLangPack = window.SakuraLangPack || {};
    window.SakuraLangPack.my = { dict: D, patterns: P, legal: window.LEGAL_DOCS_MY };
})();
