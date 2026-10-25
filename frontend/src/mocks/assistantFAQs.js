/**
 * SaveBite Predefined Questions and Fixed Answers FAQ Database
 * Rule-based, local knowledge base for the SaveBite Help Assistant.
 */

export const FAQ_CATEGORIES = [
  { id: 'all', label: 'All FAQs', icon: 'Sparkles' },
  { id: 'about', label: 'About SaveBite', icon: 'Info' },
  { id: 'dashboard', label: 'Dashboard & Use First', icon: 'LayoutDashboard' },
  { id: 'pantry', label: 'Pantry Management', icon: 'Refrigerator' },
  { id: 'receipt_barcode', label: 'Receipt & Barcode', icon: 'ScanLine' },
  { id: 'storage', label: 'Smart Storage (IoT)', icon: 'Cpu' },
  { id: 'recipes', label: 'Rescue Recipes', icon: 'ChefHat' },
  { id: 'shopping', label: 'Shopping List', icon: 'ShoppingBag' },
  { id: 'waste', label: 'Waste Analytics', icon: 'BarChart3' },
  { id: 'safety', label: 'Freshness & Safety', icon: 'ShieldCheck' },
  { id: 'settings', label: 'Profile & Settings', icon: 'Settings' },
]

export const ASSISTANT_FAQS = [
  // A. About SaveBite
  {
    id: 'about-1',
    category: 'about',
    question: 'What is SaveBite?',
    answer:
      'SaveBite is a grocery and food-waste management application that helps households track pantry inventory, monitor expiry dates, plan grocery purchases, and reduce food waste.',
    keywords: ['what is savebite', 'overview', 'about savebite', 'app', 'purpose', 'food waste'],
  },
  {
    id: 'about-2',
    category: 'about',
    question: 'What can I do with SaveBite?',
    answer:
      'You can manage groceries, track expiry dates, monitor storage conditions when supported, explore recipes using pantry ingredients, maintain shopping lists, and review food-waste analytics.',
    keywords: ['what can i do', 'features', 'capabilities', 'functions', 'tools'],
  },
  {
    id: 'about-3',
    category: 'about',
    question: 'How do I get started?',
    answer:
      'Open your dashboard to view your pantry summary. Add groceries manually or use the available receipt and barcode features. Then explore your pantry, shopping list, recipes, and Smart Storage.',
    keywords: ['get started', 'how to start', 'guide', 'tutorial', 'first steps', 'begin'],
  },

  // B. Dashboard
  {
    id: 'dash-1',
    category: 'dashboard',
    question: 'What does my dashboard show?',
    answer:
      'Your dashboard summarizes pantry items, products nearing expiry, low-stock items, estimated pantry value, recent activity, and items you may want to use first.',
    keywords: ['dashboard', 'summary', 'overview', 'home', 'stats', 'metrics', 'pantry value'],
  },
  {
    id: 'dash-2',
    category: 'dashboard',
    question: 'What is Use First?',
    answer:
      'Use First highlights items that may deserve earlier attention based on available expiry information and other configured prioritization factors. It is a planning aid, not a food-safety guarantee.',
    keywords: ['use first', 'priority', 'urgent', 'expiring first', 'spoilage risk', 'scoring'],
  },

  // C. Pantry Management
  {
    id: 'pantry-1',
    category: 'pantry',
    question: 'How do I add groceries?',
    answer:
      'Open Add Groceries and select Manual Entry. Enter the product name, category, quantity, purchase date, expiry date if known, storage location, and price. Save the form to add the item.',
    keywords: ['add groceries', 'add items', 'new food', 'manual entry', 'log grocery', 'record food'],
  },
  {
    id: 'pantry-2',
    category: 'pantry',
    question: 'How do I find an item in my pantry?',
    answer:
      'Open My Pantry and use the search box or available category, storage-location, and freshness filters.',
    keywords: ['find item', 'search pantry', 'filter', 'locate food', 'browse inventory'],
  },
  {
    id: 'pantry-3',
    category: 'pantry',
    question: 'How do I mark an item as consumed or wasted?',
    answer:
      'Open the relevant pantry item and select the appropriate action. Review the quantity and confirm the action. The inventory and related activity records should update accordingly.',
    keywords: ['mark consumed', 'wasted', 'eat', 'spoil', 'discard', 'finish food', 'deduct'],
  },

  // D. Receipt and Barcode Features
  {
    id: 'rb-1',
    category: 'receipt_barcode',
    question: 'Can I add groceries using a receipt?',
    answer:
      'If receipt processing is enabled, open Add Groceries, select Upload Receipt, and follow the review steps. Check the extracted product names and quantities before confirming the items.',
    keywords: ['receipt', 'scan receipt', 'upload receipt', 'ocr', 'invoice', 'bill'],
  },
  {
    id: 'rb-2',
    category: 'receipt_barcode',
    question: 'How does barcode lookup work?',
    answer:
      'Open Add Groceries, select Scan Barcode, and scan or enter a barcode if the feature is available. Review the product details before adding it to your pantry.',
    keywords: ['barcode', 'scan barcode', 'upc', 'ean', 'scanner', 'lookup'],
  },
  {
    id: 'rb-3',
    category: 'receipt_barcode',
    question: 'Are receipt and barcode results always accurate?',
    answer:
      'No. Extracted receipt details and product matches may be incomplete or incorrect. Review the information before confirming it.',
    keywords: ['accuracy', 'accurate', 'error in receipt', 'barcode wrong', 'mistake', 'verify'],
  },

  // E. Smart Storage
  {
    id: 'storage-1',
    category: 'storage',
    question: 'What is Smart Storage?',
    answer:
      'Smart Storage displays supported storage-device readings, such as temperature, humidity, and other configured indicators, along with historical charts and alerts.',
    keywords: ['smart storage', 'iot', 'sensors', 'temperature', 'humidity', 'esp32', 'devices'],
  },
  {
    id: 'storage-2',
    category: 'storage',
    question: 'Are Smart Storage readings real?',
    answer:
      'Readings are real only when an actual device integration is configured and supplying data. Demo mode may display simulated readings, which should be clearly labeled.',
    keywords: ['real readings', 'sensor real', 'simulated', 'demo hardware', 'telemetry real'],
  },
  {
    id: 'storage-3',
    category: 'storage',
    question: 'What do storage alerts mean?',
    answer:
      'Storage alerts indicate that a configured threshold or monitoring condition needs attention. Check the displayed reason and verify the physical storage conditions where appropriate.',
    keywords: ['storage alerts', 'temperature alert', 'threshold', 'warm fridge', 'warning'],
  },

  // F. Recipes
  {
    id: 'recipes-1',
    category: 'recipes',
    question: 'How do I find recipes using my groceries?',
    answer:
      'Open AI Recipes to browse available recommendations, search for recipes, and review which ingredients you already have and which are missing.',
    keywords: ['find recipes', 'recipes', 'cook', 'meals', 'ingredients', 'rescue recipes', 'dish'],
  },
  {
    id: 'recipes-2',
    category: 'recipes',
    question: 'Can I use pantry ingredients for a recipe?',
    answer:
      'Open a recipe, review its required ingredients and quantities, and use the ingredient action if available. Confirm before making changes to your pantry inventory.',
    keywords: ['use pantry ingredients', 'cook recipe', 'deduct ingredients', 'make recipe'],
  },

  // G. Shopping List
  {
    id: 'shopping-1',
    category: 'shopping',
    question: 'How do I create a shopping list?',
    answer:
      'Open Shopping List and add products with the required quantities and estimated prices. You can also use suggested items when that feature is available.',
    keywords: ['create shopping list', 'shopping list', 'add to list', 'groceries to buy', 'cart'],
  },
  {
    id: 'shopping-2',
    category: 'shopping',
    question: 'Why does SaveBite warn me about duplicate purchases?',
    answer:
      'A similar product may already exist in your pantry. Review its quantity and expiry information before deciding whether to buy more.',
    keywords: ['duplicate warning', 'overbuy', 'already in pantry', 'why warning', 'surplus'],
  },
  {
    id: 'shopping-3',
    category: 'shopping',
    question: 'How do I mark an item as purchased?',
    answer:
      'Open your shopping list, mark the relevant item as purchased, and use the available pantry-addition action if you want to record the purchased quantity in your inventory.',
    keywords: ['mark as purchased', 'bought', 'purchase item', 'add to pantry from list'],
  },

  // H. Waste Analytics
  {
    id: 'waste-1',
    category: 'waste',
    question: 'What is Waste Analytics?',
    answer:
      'Waste Analytics summarizes recorded food waste, estimated financial loss, consumption history, and waste trends when sufficient data is available.',
    keywords: ['waste analytics', 'waste report', 'food waste stats', 'financial loss', 'metrics'],
  },
  {
    id: 'waste-2',
    category: 'waste',
    question: 'Are the savings shown real?',
    answer:
      'Savings may be estimates based on recorded data and calculation assumptions. Demo analytics may use sample data and should not be treated as actual household savings.',
    keywords: ['savings real', 'money saved', 'estimates', 'financial savings', 'calculation'],
  },

  // I. Freshness and Food Safety
  {
    id: 'safety-1',
    category: 'safety',
    question: 'What does a freshness score mean?',
    answer:
      'A freshness score is an estimate used to help prioritize items. It does not guarantee that food is safe to eat.',
    keywords: ['freshness score', 'safety', 'edible', 'is it safe', 'score meaning', 'safe to eat'],
  },
  {
    id: 'safety-2',
    category: 'safety',
    question: 'Can an image detect all food contamination?',
    answer:
      'No. Appearance alone cannot reliably identify pathogens, invisible contamination, or every form of spoilage. Always follow appropriate food-handling guidance.',
    keywords: ['image detect contamination', 'scan photo safe', 'bacteria', 'pathogens', 'spoilage'],
  },
  {
    id: 'safety-3',
    category: 'safety',
    question: 'Is SaveBite a food-safety certification system?',
    answer:
      'No. SaveBite provides inventory management and informational guidance, not food-safety certification.',
    keywords: ['food safety certification', 'certified', 'medical', 'guarantee', 'fda'],
  },

  // J. Profile and Settings
  {
    id: 'settings-1',
    category: 'settings',
    question: 'How do I change my preferences?',
    answer:
      'Open Profile or Settings to review the available household, dietary, cuisine, notification, and waste-reduction preferences.',
    keywords: ['change preferences', 'settings', 'profile', 'dietary', 'household name'],
  },
  {
    id: 'settings-2',
    category: 'settings',
    question: 'How do I log out?',
    answer:
      'Use the existing Sign Out option in your profile or settings area.',
    keywords: ['log out', 'sign out', 'disconnect', 'leave account', 'exit'],
  },
]

export const FALLBACK_MESSAGE =
  "I'm a predefined SaveBite help assistant, so I can answer questions about the app's features and workflows. Please choose one of the suggested questions or browse a help category."

export const WELCOME_MESSAGE =
  "Hello! I am the **SaveBite Help Assistant**. I can help you understand how SaveBite works, including pantry inventory, Use First alerts, IoT smart storage, rescue recipes, duplicate purchase warnings, and food-waste analytics.\n\nChoose any question chip below or select a category to get started!"
