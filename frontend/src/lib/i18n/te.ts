import type { MessageKey } from './en';

/**
 * DRAFT Telugu strings. NOT reviewed by a native speaker yet (PRODUCT_SPEC.md section 7 requires
 * that review before any pilot). Keys that are missing here fall back to English.
 */
export const te: Partial<Record<MessageKey, string>> = {
  'common.loading': 'లోడ్ అవుతోంది…',
  'common.retry': 'మళ్లీ ప్రయత్నించండి',
  'common.cancel': 'రద్దు చేయండి',
  'common.back': 'వెనుకకు',
  'common.save': 'సేవ్ చేయండి',
  'common.close': 'మూసివేయండి',
  'common.search': 'వెతకండి',
  'common.loadMore': 'ఇంకా చూపించండి',
  'common.confirm': 'నిర్ధారించండి',
  'common.edit': 'సవరించండి',

  'nav.home': 'హోమ్',
  'nav.invoices': 'ఇన్వాయిస్‌లు',
  'nav.customers': 'కస్టమర్లు',
  'nav.more': 'మరిన్ని',

  'gate.waking.title': 'సర్వర్ ప్రారంభమవుతోంది…',
  'gate.down.title': 'సర్వర్‌ను చేరుకోలేకపోతున్నాం',

  'auth.title': 'సైన్ ఇన్',
  'auth.email': 'ఈమెయిల్ చిరునామా',
  'auth.sendCode': 'కోడ్ పంపండి',
  'auth.code': 'ఈమెయిల్‌లో వచ్చిన కోడ్',
  'auth.verify': 'సైన్ ఇన్ చేయండి',
  'auth.signOut': 'సైన్ అవుట్',

  'workspace.pickTitle': 'మీ వ్యాపారాన్ని ఎంచుకోండి',
  'workspace.name': 'వ్యాపారం పేరు',
  'workspace.create': 'వ్యాపారాన్ని సృష్టించండి',

  'status.unpaid': 'చెల్లించలేదు',
  'status.partial': 'కొంత చెల్లించారు',
  'status.settled': 'పూర్తిగా చెల్లించారు',
  'status.overdue': 'గడువు దాటింది',
  'status.cancelled': 'రద్దు చేశారు',

  'dash.title': 'హోమ్',
  'dash.totalOutstanding': 'మొత్తం బకాయి',
  'dash.overdue': 'గడువు దాటినవి',
  'dash.collected': 'గత 30 రోజుల్లో వసూలైనది',
  'dash.aging': 'ఆలస్యం ప్రకారం బకాయిలు',
  'dash.bucket.current': 'గడువు ఇంకా రాలేదు',
  'dash.bucket.1-30': '1–30 రోజులు ఆలస్యం',
  'dash.bucket.31-60': '31–60 రోజులు ఆలస్యం',
  'dash.bucket.61-90': '61–90 రోజులు ఆలస్యం',
  'dash.bucket.90+': '90 రోజులకు పైగా ఆలస్యం',

  'customers.title': 'కస్టమర్లు',
  'customers.new': 'కొత్త కస్టమర్',
  'customers.name': 'కస్టమర్ పేరు',
  'customers.phone': 'ఫోన్ నంబర్',
  'customers.outstanding': 'బకాయి',
  'customers.overdue': 'గడువు దాటినవి',

  'invoices.title': 'ఇన్వాయిస్‌లు',
  'invoices.new': 'కొత్త ఇన్వాయిస్',
  'invoices.number': 'ఇన్వాయిస్ నంబర్',
  'invoices.date': 'ఇన్వాయిస్ తేదీ',
  'invoices.due': 'చెల్లింపు గడువు',
  'invoices.amount': 'ఇన్వాయిస్ మొత్తం',
  'invoices.total': 'ఇన్వాయిస్ మొత్తం',
  'invoices.paid': 'చెల్లించినది',
  'invoices.outstanding': 'బకాయి',
  'invoices.payments': 'చెల్లింపులు',
  'invoices.recordPayment': 'చెల్లింపు నమోదు చేయండి',
  'invoices.cancelInvoice': 'ఇన్వాయిస్ రద్దు చేయండి',

  'pay.title': 'చెల్లింపు నమోదు',
  'pay.amount': 'అందిన మొత్తం',
  'pay.date': 'అందిన తేదీ',
  'pay.method': 'ఎలా చెల్లించారు?',
  'pay.method.cash': 'నగదు',
  'pay.method.upi': 'UPI',
  'pay.method.bank_transfer': 'బ్యాంక్ బదిలీ',
  'pay.method.cheque': 'చెక్కు',
  'pay.method.other': 'ఇతర',
  'pay.reference': 'రిఫరెన్స్',
  'pay.review': 'చెల్లింపును సమీక్షించండి',
  'pay.reviewBalanceAfter': 'ఈ చెల్లింపు తర్వాత బకాయి',
  'pay.confirm': 'చెల్లింపును సేవ్ చేయండి',
  'pay.reverse': 'రివర్స్ చేయండి',
  'pay.status.reversed': 'రివర్స్ చేశారు',

  'account.title': 'మరిన్ని',
  'account.language': 'భాష',
  'lang.en': 'English',
  'lang.te': 'తెలుగు',

  'err.network_error':
    'సర్వర్‌ను చేరుకోలేకపోతున్నాం. ఇంటర్నెట్ కనెక్షన్ చూసి మళ్లీ ప్రయత్నించండి.',
  'err.overpayment_rejected':
    'ఇది ఇన్వాయిస్‌లో మిగిలిన బకాయి కంటే ఎక్కువ. తక్కువ మొత్తం ఇవ్వండి.',
  'err.duplicate_invoice_number':
    'ఈ ఇన్వాయిస్ నంబర్ ఈ ఆర్థిక సంవత్సరంలో ఇప్పటికే వాడారు.',
};
