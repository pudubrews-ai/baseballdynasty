// Player name pools by origin group
// All names must match: /^[\p{L}'.\- ]{1,40}$/u
// Cultural consistency enforced: Japanese surname only with Japanese first name, etc.

export type OriginKey = 'us' | 'latin' | 'japanese' | 'korean' | 'taiwanese' | 'canadian' | 'european' | 'other';

export interface NamePool {
  first: string[];
  last: string[];
  country: string;
}

export const NAME_POOLS: Record<OriginKey, NamePool> = {
  us: {
    country: 'USA',
    first: [
      'James', 'Michael', 'Robert', 'William', 'David', 'John', 'Richard', 'Joseph', 'Thomas', 'Charles',
      'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
      'Kenneth', 'Kevin', 'Brian', 'George', 'Timothy', 'Ronald', 'Edward', 'Jason', 'Jeffrey', 'Ryan',
      'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon',
      'Benjamin', 'Samuel', 'Raymond', 'Gregory', 'Frank', 'Alexander', 'Patrick', 'Jack', 'Dennis', 'Jerry',
      'Tyler', 'Aaron', 'Jose', 'Adam', 'Henry', 'Nathan', 'Zachary', 'Douglas', 'Peter', 'Kyle',
      'Marcus', 'Terrence', 'DeShawn', 'Malik', 'Darius', 'Elijah', 'Isaiah', 'Xavier', 'Devon', 'Jamal',
      'Caleb', 'Evan', 'Owen', 'Lucas', 'Logan', 'Dylan', 'Ethan', 'Mason', 'Aiden', 'Carter',
    ],
    last: [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Anderson', 'Taylor',
      'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Martinez', 'Robinson', 'Clark',
      'Rodriguez', 'Lewis', 'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'Hernandez', 'King', 'Wright',
      'Lopez', 'Hill', 'Scott', 'Green', 'Adams', 'Baker', 'Gonzalez', 'Nelson', 'Carter', 'Mitchell',
      'Perez', 'Roberts', 'Turner', 'Phillips', 'Campbell', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart',
      'Sanchez', 'Morris', 'Rogers', 'Reed', 'Cook', 'Morgan', 'Bell', 'Murphy', 'Bailey', 'Rivera',
      'Cooper', 'Richardson', 'Cox', 'Howard', 'Ward', 'Torres', 'Peterson', 'Gray', 'Ramirez', 'James',
      'Watson', 'Brooks', 'Kelly', 'Sanders', 'Price', 'Bennett', 'Wood', 'Barnes', 'Ross', 'Henderson',
      'Coleman', 'Jenkins', 'Perry', 'Powell', 'Long', 'Patterson', 'Hughes', 'Flores', 'Washington', 'Butler',
    ],
  },

  latin: {
    country: 'Dominican Republic',
    first: [
      'Miguel', 'Carlos', 'Jose', 'Juan', 'Pedro', 'Ramon', 'Eduardo', 'Fernando', 'Roberto', 'Victor',
      'Diego', 'Luis', 'Manuel', 'Alejandro', 'Ricardo', 'Alberto', 'Hector', 'Cesar', 'Jorge', 'Rafael',
      'Gabriel', 'Andres', 'Felipe', 'Arturo', 'Francisco', 'Oscar', 'Ivan', 'Ernesto', 'Orlando', 'Julio',
      'Marcos', 'Nicolas', 'Sergio', 'Pablo', 'Gustavo', 'Ruben', 'Emilio', 'Javier', 'Ignacio', 'Rodrigo',
      'Adan', 'Armando', 'Bernardo', 'Cristian', 'Daniel', 'Enrique', 'Federico', 'Gerardo', 'Horacio', 'Ismael',
      'Jonathan', 'Kevin', 'Leonardo', 'Mauricio', 'Nelson', 'Omar', 'Pascal', 'Quentin', 'Samuel', 'Tomas',
    ],
    last: [
      'Rodriguez', 'Garcia', 'Martinez', 'Lopez', 'Hernandez', 'Gonzalez', 'Perez', 'Sanchez', 'Torres', 'Ramirez',
      'Flores', 'Rivera', 'Morales', 'Reyes', 'Cruz', 'Ortiz', 'Gutierrez', 'Chavez', 'Ramos', 'Castillo',
      'Moreno', 'Romero', 'Jimenez', 'Alvarez', 'Nunez', 'Ruiz', 'Medina', 'Vargas', 'Soto', 'Castro',
      'Diaz', 'Mendoza', 'Aguilar', 'Rojas', 'Acosta', 'Vega', 'Figueroa', 'Cabrera', 'Herrera', 'Fuentes',
      'De la Cruz', 'Pena', 'Delgado', 'Batista', 'Candelario', 'Almonte', 'Marte', 'Familia', 'Cedeno', 'Paulino',
      'Montero', 'Mercedes', 'Valdez', 'Santos', 'Tavarez', 'Encarnacion', 'Bautista', 'Liriano', 'Feliz', 'Ogando',
    ],
  },

  japanese: {
    country: 'Japan',
    first: [
      'Hiroshi', 'Kenji', 'Takeshi', 'Yuki', 'Daisuke', 'Shohei', 'Kodai', 'Roki', 'Masahiro', 'Yusei',
      'Kenta', 'Kohei', 'Seiya', 'Yoshida', 'Toru', 'Akira', 'Ryota', 'Koki', 'Tomoyuki', 'Hayato',
      'Shun', 'Kaito', 'Haruto', 'Soma', 'Ren', 'Yuta', 'Daiki', 'Sho', 'Taiyo', 'Naoki',
      'Fumiya', 'Genta', 'Hiro', 'Itsuki', 'Junpei', 'Kazuki', 'Leo', 'Mao', 'Nao', 'Osamu',
    ],
    last: [
      'Tanaka', 'Suzuki', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada',
      'Sasaki', 'Yamaguchi', 'Saito', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Yamazaki', 'Mori',
      'Abe', 'Ikeda', 'Hashimoto', 'Yamashita', 'Ishikawa', 'Ogawa', 'Ueda', 'Okamoto', 'Fujita', 'Nishimura',
      'Fukuda', 'Goto', 'Hasegawa', 'Maeda', 'Ota', 'Okada', 'Otsuka', 'Kaneko', 'Wada', 'Sato',
    ],
  },

  korean: {
    country: 'South Korea',
    first: [
      'Hyun-jin', 'Chan-ho', 'Seung-hwan', 'Ji-man', 'Kwang-hyun', 'Byung-ho', 'Seung-yeop', 'Jung-hoo', 'Hye-seong', 'Dae-ho',
      'Min-jun', 'Jae-hwan', 'Woo-suk', 'Sang-su', 'Do-hwan', 'Gil-su', 'Ha-min', 'In-guk', 'Jong-min', 'Kyung-hwan',
      'Lee-jun', 'Min-su', 'Nam-il', 'Oh-sung', 'Pil-su', 'Rak-hwan', 'Seok-jin', 'Tae-hwan', 'Ui-min', 'Vin-jin',
      'Won-suk', 'Yong-hyun', 'Zin-su', 'Ah-reum', 'Bong-su', 'Chul-jin', 'Dal-su', 'Eun-suk', 'Gi-hwan', 'Ha-eun',
    ],
    last: [
      'Kim', 'Lee', 'Park', 'Choi', 'Jung', 'Kang', 'Cho', 'Yoon', 'Lim', 'Han',
      'Oh', 'Seo', 'Shin', 'Kwon', 'Hwang', 'Ahn', 'Song', 'Jeon', 'Hong', 'Moon',
      'Yang', 'Son', 'Baek', 'Nam', 'Jang', 'Im', 'Ryu', 'Noh', 'Yoo', 'Heo',
      'Shim', 'Bae', 'Go', 'Woo', 'Goo', 'Cha', 'Min', 'Ok', 'Pi', 'Ju',
    ],
  },

  taiwanese: {
    country: 'Taiwan',
    first: [
      'Wei-Yin', 'Chien-Ming', 'Kuo-Hui', 'Che-Hsuan', 'Manny', 'Ching-Lin', 'Wei-Chung', 'Chih-Wei', 'Ming-Chang', 'Kang-Shuo',
      'Jun-Wei', 'Chia-Jen', 'De-An', 'En-Wei', 'Fu-Lin', 'Guo-Hua', 'Hai-Peng', 'I-Feng', 'Jian-Ming', 'Kun-Wei',
      'Liang-Wei', 'Meng-Hao', 'Nian-Tzu', 'Pei-Hao', 'Qian-Rui', 'Rui-Lin', 'Sheng-Long', 'Tzu-Wei', 'Wen-Bin', 'Xuan-Zhi',
      'Ya-Hui', 'Zhong-Wei', 'An-De', 'Bo-Xian', 'Chun-Cheng', 'De-Sheng', 'Feng-Wei', 'Guo-Liang', 'Hao-Chen', 'I-Cheng',
    ],
    last: [
      'Chen', 'Lin', 'Huang', 'Chang', 'Wu', 'Wang', 'Liu', 'Hsu', 'Cheng', 'Yang',
      'Lo', 'Tsai', 'Chou', 'Chu', 'Liao', 'Tang', 'Hsiao', 'Kuo', 'Hsiao', 'Peng',
      'Chiu', 'Fang', 'Su', 'Lee', 'Weng', 'Yeh', 'Yen', 'Tzeng', 'Shih', 'Lai',
      'Nien', 'Hung', 'Tung', 'Jiang', 'Fu', 'Ou', 'Meng', 'Shen', 'Zhuang', 'Gao',
    ],
  },

  canadian: {
    country: 'Canada',
    first: [
      'Ryan', 'Tyler', 'Brett', 'Kyle', 'Cody', 'Jordan', 'Cole', 'Blake', 'Liam', 'Ethan',
      'Noah', 'Logan', 'Hunter', 'Brady', 'Chase', 'Derek', 'Brendan', 'Travis', 'Mitchell', 'Garrett',
      'Connor', 'Brayden', 'Dalton', 'Dustin', 'Evan', 'Gavin', 'Hayden', 'Ian', 'Jake', 'Kaden',
      'Lance', 'Mason', 'Nathan', 'Owen', 'Parker', 'Quinn', 'Reid', 'Shane', 'Tanner', 'Wade',
    ],
    last: [
      'Martin', 'Roy', 'Tremblay', 'Gagnon', 'Bouchard', 'Morin', 'Lavoie', 'Fortin', 'Gauthier', 'Ouellet',
      'Thompson', 'Anderson', 'Taylor', 'Campbell', 'MacDonald', 'Murray', 'Morrison', 'Reid', 'Fraser', 'Grant',
      'Smith', 'Brown', 'Johnson', 'Williams', 'Jones', 'Miller', 'Wilson', 'Moore', 'Davis', 'Clark',
      'Dion', 'Pelletier', 'Bergeron', 'Cyr', 'Belanger', 'Lacroix', 'Lapointe', 'Gosselin', 'Poirier', 'Desjardins',
    ],
  },

  european: {
    country: 'Netherlands',
    first: [
      'Didi', 'Rick', 'Jurickson', 'Andrelton', 'Lars', 'Dirk', 'Hans', 'Stefan', 'Marco', 'Oliver',
      'Maximilian', 'Sebastian', 'Lukas', 'Florian', 'Tobias', 'Jonas', 'Jan', 'Klaus', 'Ralf', 'Uwe',
      'Pierre', 'Jean-Pierre', 'Christophe', 'Antoine', 'Guillaume', 'Luca', 'Marco', 'Matteo', 'Giovanni', 'Paolo',
      'Francesco', 'Alessandro', 'Stefano', 'Davide', 'Riccardo', 'James', 'Robert', 'George', 'David', 'Andrew',
    ],
    last: [
      'Gregorius', 'van den Berg', 'de Vries', 'Jansen', 'Bakker', 'Visser', 'Smits', 'Meijer', 'Boer', 'Mulder',
      'Schmidt', 'Weber', 'Bauer', 'Fischer', 'Meyer', 'Wagner', 'Schulz', 'Becker', 'Hoffmann', 'Koch',
      'Rossi', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Gallo', 'Costa', 'Russo', 'Greco', 'Ricci',
      'Chapman', 'Davies', 'Evans', 'Hughes', 'Lewis', 'Morgan', 'Price', 'Rees', 'Thomas', 'Roberts',
    ],
  },

  other: {
    country: 'Australia',
    first: [
      'Liam', 'Noah', 'Oliver', 'Jack', 'Lucas', 'Ethan', 'Mason', 'Henry', 'James', 'William',
      'Kwame', 'Kofi', 'Ama', 'Yaw', 'Fiifi', 'Ofori', 'Mensah', 'Asante', 'Boateng', 'Appiah',
      'Santiago', 'Mateo', 'Emiliano', 'Facundo', 'Rodrigo', 'Tomas', 'Alexis', 'Gonzalo', 'Ezequiel', 'Leandro',
      'Bailey', 'Lachlan', 'Jayden', 'Cameron', 'Harrison', 'Angus', 'Flynn', 'Hamish', 'Beau', 'Cooper',
    ],
    last: [
      'Williams', 'Johnson', 'Brown', 'Thompson', 'Walker', 'Roberts', 'Evans', 'Davies', 'Morgan', 'Lewis',
      'Asante', 'Mensah', 'Boateng', 'Owusu', 'Acheampong', 'Ofori', 'Anane', 'Darkwah', 'Adjei', 'Ampofo',
      'Guevara', 'Morales', 'Vargas', 'Rios', 'Barrios', 'Bravo', 'Espinoza', 'Lagos', 'Orozco', 'Palma',
      'Wilson', 'Taylor', 'Martin', 'Anderson', 'Harris', 'Clark', 'Robinson', 'Wright', 'Mitchell', 'Turner',
    ],
  },
};

// Distribution percentages per the spec
export const ORIGIN_DISTRIBUTION: { key: OriginKey; pct: number; countries: string[] }[] = [
  { key: 'us', pct: 0.35, countries: ['USA'] },
  { key: 'latin', pct: 0.30, countries: ['Dominican Republic', 'Venezuela', 'Cuba', 'Puerto Rico', 'Panama', 'Colombia'] },
  { key: 'japanese', pct: 0.05, countries: ['Japan'] },
  { key: 'korean', pct: 0.05, countries: ['South Korea'] },
  { key: 'taiwanese', pct: 0.05, countries: ['Taiwan'] },
  { key: 'canadian', pct: 0.10, countries: ['Canada'] },
  { key: 'european', pct: 0.05, countries: ['Netherlands', 'Germany', 'UK', 'Italy'] },
  { key: 'other', pct: 0.05, countries: ['Australia', 'West Africa', 'Mexico'] },
];
