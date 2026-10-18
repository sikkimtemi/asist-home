import { defineMessages } from '../message'

/**
 * The fixed lines of the conversation itself, which follow the language the conversation is held in
 * and not the language of the interface: what the assistant says aloud when a turn cannot go on, and
 * the utterances a card's button sends in the user's name. They are spoken, so they are written as
 * speech, without a symbol a voice would read out or stumble on.
 */
export const spoken = defineMessages({
  replyTooLong: {
    'ja-JP': '回答が長くなりすぎたため途中で止まりました。質問を少し絞ってください。',
    'en-US': 'That answer was getting too long, so I stopped partway. Could you narrow the question a little?',
    'fr-FR': 'Ma réponse devenait trop longue, je me suis arrêté en route. Pouvez-vous resserrer un peu la question ?',
    'de-DE': 'Die Antwort wurde zu lang, deshalb habe ich sie abgebrochen. Können Sie die Frage etwas eingrenzen?',
    'hi-IN': 'जवाब बहुत लंबा होता जा रहा था, इसलिए मैं बीच में रुक गया। सवाल थोड़ा छोटा कर दीजिए।',
    'id-ID': 'Jawabannya jadi terlalu panjang, jadi saya berhenti di tengah. Bisa pertanyaannya dipersempit sedikit?',
    'it-IT': "La risposta stava diventando troppo lunga, così mi sono fermato a metà. Puoi restringere un po' la domanda?",
    'ko-KR': '답이 너무 길어져서 중간에 멈췄습니다. 질문을 조금 좁혀 주시겠어요?',
    'pt-BR': 'A resposta estava ficando longa demais, então parei no meio. Você pode estreitar um pouco a pergunta?',
    'es-419': 'La respuesta se estaba haciendo muy larga, así que me detuve a la mitad. ¿Puedes acotar un poco la pregunta?',
    'es-ES': 'La respuesta se estaba haciendo demasiado larga, así que me he parado a la mitad. ¿Puedes acotar un poco la pregunta?'
  },
  cannotAnswer: {
    'ja-JP': 'この依頼には応答できませんでした。内容や聞き方を変えてください。',
    'en-US': "I couldn't answer that one. Try changing what you ask, or how you ask it.",
    'fr-FR': "Je n'ai pas pu répondre à cette demande. Essayez de changer le contenu, ou la façon de le demander.",
    'de-DE': 'Darauf konnte ich nicht antworten. Versuchen Sie es mit einem anderen Inhalt oder einer anderen Formulierung.',
    'hi-IN': 'इस बात का जवाब मैं नहीं दे सका। कुछ और पूछकर या पूछने का तरीका बदलकर देखिए।',
    'id-ID': 'Saya tidak bisa menjawab permintaan itu. Coba ubah isinya, atau cara bertanyanya.',
    'it-IT': 'A questa richiesta non sono riuscito a rispondere. Prova a cambiare il contenuto, o il modo di chiederlo.',
    'ko-KR': '이 요청에는 답할 수 없었습니다. 내용이나 묻는 방식을 바꿔 보십시오.',
    'pt-BR': 'Não consegui responder a esse pedido. Tente mudar o conteúdo, ou o jeito de perguntar.',
    'es-419': 'No pude responder a eso. Prueba a cambiar el contenido, o la forma de preguntarlo.',
    'es-ES': 'No he podido responder a eso. Prueba a cambiar el contenido, o la forma de preguntarlo.'
  },
  turnStopped: {
    'ja-JP': '処理が長く続いたため、このターンを安全に停止しました。質問を少し絞ってください。',
    'en-US': 'This was running for a long time, so I stopped here to be safe. Could you narrow the question a little?',
    'fr-FR': 'Le traitement durait trop longtemps, je me suis arrêté ici par sécurité. Pouvez-vous resserrer un peu la question ?',
    'de-DE': 'Das lief zu lange, deshalb habe ich hier sicherheitshalber gestoppt. Können Sie die Frage etwas eingrenzen?',
    'hi-IN': 'काम बहुत देर तक चलता रहा, इसलिए मैंने इसे यहीं सुरक्षित ढंग से रोक दिया। सवाल थोड़ा छोटा कर दीजिए।',
    'id-ID': 'Prosesnya berjalan terlalu lama, jadi saya hentikan di sini supaya aman. Bisa pertanyaannya dipersempit sedikit?',
    'it-IT': "Stava andando avanti da troppo tempo, così mi sono fermato qui per sicurezza. Puoi restringere un po' la domanda?",
    'ko-KR': '처리가 너무 오래 이어져서 여기서 안전하게 멈췄습니다. 질문을 조금 좁혀 주시겠어요?',
    'pt-BR': 'Isso estava demorando demais, então parei por aqui, por segurança. Você pode estreitar um pouco a pergunta?',
    'es-419': 'Esto estaba tardando demasiado, así que me detuve aquí por seguridad. ¿Puedes acotar un poco la pregunta?',
    'es-ES': 'Esto estaba tardando demasiado, así que me he parado aquí por seguridad. ¿Puedes acotar un poco la pregunta?'
  },
  historyFull: {
    'ja-JP': '会話が長くなったので、いま要約しています。少ししてから、もう一度話しかけてください。',
    'en-US': "Our conversation has grown long, so I'm summarizing it now. Give me a little while, then speak to me again.",
    'fr-FR': 'Notre conversation est devenue longue, je suis en train de la résumer. Laissez-moi un moment, puis reparlez-moi.',
    'de-DE': 'Unser Gespräch ist lang geworden, deshalb fasse ich es gerade zusammen. Geben Sie mir einen Moment und sprechen Sie mich dann noch einmal an.',
    'hi-IN': 'हमारी बातचीत लंबी हो गई है, इसलिए मैं अभी उसका सार बना रहा हूँ। थोड़ी देर बाद फिर बोलिए।',
    'id-ID': 'Percakapan kita sudah panjang, jadi saya sedang merangkumnya. Tunggu sebentar, lalu bicara lagi dengan saya.',
    'it-IT': 'La nostra conversazione è diventata lunga, così la sto riassumendo. Dammi un momento, poi parlami di nuovo.',
    'ko-KR': '대화가 길어져서 지금 요약하고 있습니다. 잠시 뒤에 다시 말씀해 주세요.',
    'pt-BR': 'Nossa conversa ficou longa, então estou resumindo agora. Me dá um instante e depois fala comigo de novo.',
    'es-419': 'Nuestra conversación se hizo larga, así que la estoy resumiendo. Dame un momento y luego vuelve a hablarme.',
    'es-ES': 'Nuestra conversación se ha hecho larga, así que la estoy resumiendo. Dame un momento y luego vuelve a hablarme.'
  },
  ask: {
    searchResult: {
      'ja-JP': 'この検索結果について詳しく教えて: {title}',
      'en-US': 'Tell me more about this search result: {title}',
      'fr-FR': 'Parle-moi de ce résultat de recherche : {title}',
      'de-DE': 'Erzähl mir mehr zu diesem Suchergebnis: {title}',
      'hi-IN': 'इस सर्च नतीजे के बारे में और बताओ: {title}',
      'id-ID': 'Ceritakan lebih banyak soal hasil pencarian ini: {title}',
      'it-IT': 'Raccontami di più su questo risultato di ricerca: {title}',
      'ko-KR': '이 검색 결과에 대해 자세히 알려줘: {title}',
      'pt-BR': 'Me conta mais sobre este resultado de busca: {title}',
      'es-419': 'Cuéntame más sobre este resultado de búsqueda: {title}',
      'es-ES': 'Cuéntame más sobre este resultado de búsqueda: {title}'
    },
    news: {
      'ja-JP': 'このニュースについて要約して: {title}',
      'en-US': 'Sum up this news story for me: {title}',
      'fr-FR': 'Résume-moi cette actualité : {title}',
      'de-DE': 'Fass mir diese Nachricht zusammen: {title}',
      'hi-IN': 'इस खबर का सार बताओ: {title}',
      'id-ID': 'Ringkas berita ini: {title}',
      'it-IT': 'Riassumimi questa notizia: {title}',
      'ko-KR': '이 뉴스 요약해 줘: {title}',
      'pt-BR': 'Me resume esta notícia: {title}',
      'es-419': 'Resúmeme esta noticia: {title}',
      'es-ES': 'Resúmeme esta noticia: {title}'
    }
  },
  calendarReminderRequest: {
    'ja-JP': '本日これから始まる予定を知らせてください。',
    'en-US': 'Please announce the events still to start today.',
    'fr-FR': 'Annonce les événements qui doivent encore commencer aujourd’hui.',
    'de-DE': 'Bitte kündige die heute noch beginnenden Termine an.',
    'hi-IN': 'कृपया आज के बाकी आगामी कार्यक्रम सुनाएँ।',
    'id-ID': 'Tolong umumkan acara yang belum dimulai hari ini.',
    'it-IT': 'Annuncia gli eventi che devono ancora iniziare oggi.',
    'ko-KR': '오늘 앞으로 시작할 일정을 알려 주세요.',
    'pt-BR': 'Anuncie os eventos que ainda vão começar hoje.',
    'es-419': 'Anuncia los eventos que aún no empiezan hoy.',
    'es-ES': 'Anuncia los eventos que aún no han empezado hoy.'
  }
})
