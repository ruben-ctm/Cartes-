import { shuffle } from './prng.js';

// [question, bonne réponse, mauvaises réponses…] ; les vrai/faux gardent l'ordre Vrai, Faux.
const BANK = [
  ['Capitale de l\'Australie ?', 'Canberra', 'Sydney', 'Melbourne', 'Perth'],
  ['Symbole chimique de l\'or ?', 'Au', 'Ag', 'Fe', 'Pb'],
  ['Plus grande planète du système solaire ?', 'Jupiter', 'Saturne', 'Neptune', 'Mars'],
  ['Auteur des Misérables ?', 'Victor Hugo', 'Émile Zola', 'Balzac', 'Flaubert'],
  ['Fleuve qui traverse Paris ?', 'La Seine', 'La Loire', 'Le Rhône', 'La Garonne'],
  ['Langage exécuté nativement par les navigateurs ?', 'JavaScript', 'Fortran', 'COBOL', 'Pascal'],
  ['Protocole sécurisé du web ?', 'HTTPS', 'FTP', 'Telnet', 'SMTP'],
  ['Port par défaut de HTTPS ?', 'Port 443', 'Port 80', 'Port 22', 'Port 25'],
  ['Mer entre l\'Europe et l\'Afrique ?', 'Méditerranée', 'Baltique', 'Caspienne', 'Rouge'],
  ['Qui a peint la Joconde ?', 'Léonard de Vinci', 'Raphaël', 'Michel-Ange', 'Botticelli'],
  ['Plus long fleuve d\'Europe ?', 'Volga', 'Danube', 'Rhin', 'Loire'],
  ['Mot de passe : vaut-il mieux le hacher avec sel ?', 'Oui', 'Non', 'Seulement en HTTP', 'Cela dépend du navigateur'],
  ['Le Soleil est une étoile.', 'Vrai', 'Faux'],
  ['SHA-256 est un chiffrement réversible.', 'Faux', 'Vrai'],
];

/**
 * Génère un quiz déterministe : questions mélangées, ordre des choix mélangé,
 * index de la bonne réponse uniformément réparti.
 * @returns {{uuid:string,title:string,timeAvailable:number,questions:{text:string,choices:string[],correctIndex:number}[]}}
 */
export function generateQuiz(rand, count = 12) {
  const order = shuffle(BANK.map((_, i) => i), rand);
  const questions = [];
  for (let n = 0; n < count; n++) {
    const [text, good, ...bad] = BANK[order[n % BANK.length]];
    const trueFalse = bad.length === 1;
    const choices = trueFalse ? [good, ...bad].sort((a, b) => (a === 'Vrai' ? -1 : b === 'Vrai' ? 1 : 0)) : shuffle([good, ...bad], rand);
    questions.push({ text, choices, correctIndex: choices.indexOf(good) });
  }
  return { uuid: `quiz-${Math.floor(rand() * 1e9).toString(16)}`, title: 'Quiz de test', timeAvailable: 20000, questions };
}

export const groundTruthOf = (quiz) => quiz.questions.map((q, i) => ({ q: i, correctIndex: q.correctIndex, choices: q.choices }));
