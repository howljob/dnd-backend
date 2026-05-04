const SRD_SEED_ENTITIES = [
  {
    slug: 'barbarian',
    entityType: 'class',
    stats: { hitDie: 'd12', primaryAbility: ['Strength'], saves: ['Strength', 'Constitution'] },
    translations: {
      en: {
        name: 'Barbarian',
        summary: 'A fierce warrior who relies on primal rage.',
        body: {
          sections: [
            { title: 'Role', content: 'Frontline martial class with high durability and burst damage.' },
            { title: 'Core Feature', content: 'Rage grants bonus damage and resistance to weapon damage.' }
          ]
        }
      },
      ru: {
        name: 'Варвар',
        summary: 'Яростный воин, полагающийся на первобытную ярость.',
        body: {
          sections: [
            { title: 'Роль', content: 'Фронтлайн-класс с высокой выживаемостью и взрывным уроном.' },
            { title: 'Ключевая особенность', content: 'Ярость дает бонус к урону и сопротивление физическому урону.' }
          ]
        }
      }
    }
  },
  {
    slug: 'wizard',
    entityType: 'class',
    stats: { hitDie: 'd6', primaryAbility: ['Intelligence'], saves: ['Intelligence', 'Wisdom'] },
    translations: {
      en: {
        name: 'Wizard',
        summary: 'An arcane scholar with the broadest spell list.',
        body: {
          sections: [
            { title: 'Role', content: 'Full caster focused on utility, control, and magical versatility.' },
            { title: 'Core Feature', content: 'Spellbook preparation system allows broad adaptation per day.' }
          ]
        }
      },
      ru: {
        name: 'Волшебник',
        summary: 'Арканист-исследователь с самым широким списком заклинаний.',
        body: {
          sections: [
            { title: 'Роль', content: 'Полный заклинатель с упором на контроль, утилиту и гибкость.' },
            { title: 'Ключевая особенность', content: 'Книга заклинаний и подготовка дают адаптивность под задачу.' }
          ]
        }
      }
    }
  },
  {
    slug: 'rogue',
    entityType: 'class',
    stats: { hitDie: 'd8', primaryAbility: ['Dexterity'], saves: ['Dexterity', 'Intelligence'] },
    translations: {
      en: {
        name: 'Rogue',
        summary: 'A stealth expert who excels at precision damage and skills.',
        body: {
          sections: [
            { title: 'Role', content: 'Skirmisher and scout with high utility out of combat.' },
            { title: 'Core Feature', content: 'Sneak Attack increases damage once per turn under key conditions.' }
          ]
        }
      },
      ru: {
        name: 'Плут',
        summary: 'Мастер скрытности, точечного урона и навыков.',
        body: {
          sections: [
            { title: 'Роль', content: 'Разведчик и мобильный боец с сильной внебоевой полезностью.' },
            { title: 'Ключевая особенность', content: 'Скрытая атака повышает урон раз в ход при выполнении условий.' }
          ]
        }
      }
    }
  },
  {
    slug: 'human',
    entityType: 'race',
    stats: { speed: 30, size: 'Medium', traits: ['Versatility'] },
    translations: {
      en: {
        name: 'Human',
        summary: 'Adaptable and ambitious people spread across many worlds.',
        body: { sections: [{ title: 'Traits', content: 'Humans are flexible in class choice and character concept.' }] }
      },
      ru: {
        name: 'Человек',
        summary: 'Адаптивный и амбициозный народ, широко распространенный по мирам.',
        body: { sections: [{ title: 'Черты', content: 'Люди универсальны и хорошо подходят для любых билдов.' }] }
      }
    }
  },
  {
    slug: 'elf',
    entityType: 'race',
    stats: { speed: 30, size: 'Medium', traits: ['Darkvision', 'Keen Senses', 'Fey Ancestry'] },
    translations: {
      en: {
        name: 'Elf',
        summary: 'Graceful folk with keen senses and fey heritage.',
        body: { sections: [{ title: 'Traits', content: 'Commonly gain darkvision and resistance to magical sleep.' }] }
      },
      ru: {
        name: 'Эльф',
        summary: 'Грациозный народ с острыми чувствами и наследием фей.',
        body: { sections: [{ title: 'Черты', content: 'Обычно имеют темное зрение и устойчивость к магическому сну.' }] }
      }
    }
  },
  {
    slug: 'dwarf',
    entityType: 'race',
    stats: { speed: 25, size: 'Medium', traits: ['Darkvision', 'Dwarven Resilience'] },
    translations: {
      en: {
        name: 'Dwarf',
        summary: 'Stout and hardy people known for resilience.',
        body: { sections: [{ title: 'Traits', content: 'Poison resilience and strong ties to craft and stonework.' }] }
      },
      ru: {
        name: 'Дварф',
        summary: 'Крепкий и выносливый народ, известный стойкостью.',
        body: { sections: [{ title: 'Черты', content: 'Устойчивость к яду и сильные ремесленные традиции.' }] }
      }
    }
  },
  {
    slug: 'fireball',
    entityType: 'spell',
    stats: { level: 3, school: 'Evocation', castingTime: '1 action', range: '150 feet' },
    translations: {
      en: {
        name: 'Fireball',
        summary: 'A bright streak explodes and deals fire damage in an area.',
        body: { sections: [{ title: 'Effect', content: '8d6 fire damage in a 20-foot radius sphere, Dex save for half.' }] }
      },
      ru: {
        name: 'Огненный шар',
        summary: 'Яркая вспышка взрывается и наносит огненный урон по области.',
        body: { sections: [{ title: 'Эффект', content: '8d6 огненного урона в сфере 20 футов, Ловкость на половину.' }] }
      }
    }
  },
  {
    slug: 'mage-hand',
    entityType: 'spell',
    stats: { level: 0, school: 'Conjuration', castingTime: '1 action', range: '30 feet' },
    translations: {
      en: {
        name: 'Mage Hand',
        summary: 'A spectral hand manipulates small objects at a distance.',
        body: { sections: [{ title: 'Effect', content: 'Creates a floating hand that can interact with objects.' }] }
      },
      ru: {
        name: 'Волшебная рука',
        summary: 'Призрачная рука манипулирует небольшими предметами на расстоянии.',
        body: { sections: [{ title: 'Эффект', content: 'Создает парящую руку для взаимодействия с объектами.' }] }
      }
    }
  },
  {
    slug: 'cure-wounds',
    entityType: 'spell',
    stats: { level: 1, school: 'Evocation', castingTime: '1 action', range: 'Touch' },
    translations: {
      en: {
        name: 'Cure Wounds',
        summary: 'A creature you touch regains hit points.',
        body: { sections: [{ title: 'Effect', content: 'Target regains 1d8 + spellcasting modifier hit points.' }] }
      },
      ru: {
        name: 'Лечение ран',
        summary: 'Существо, которого вы касаетесь, восстанавливает хиты.',
        body: { sections: [{ title: 'Эффект', content: 'Цель восстанавливает 1d8 + модификатор характеристики заклинаний.' }] }
      }
    }
  },
  {
    slug: 'great-weapon-master',
    entityType: 'feat',
    stats: { category: 'Combat' },
    translations: {
      en: {
        name: 'Great Weapon Master',
        summary: 'Trade accuracy for powerful blows and gain bonus attacks on crits/finishing hits.',
        body: { sections: [{ title: 'Highlights', content: 'Optional -5 to hit for +10 damage on heavy melee weapons.' }] }
      },
      ru: {
        name: 'Мастер двуручного оружия',
        summary: 'Меняйте точность на урон и получайте дополнительные атаки.',
        body: { sections: [{ title: 'Ключевое', content: 'Опционально -5 к атаке за +10 к урону тяжелым оружием.' }] }
      }
    }
  },
  {
    slug: 'sharpshooter',
    entityType: 'feat',
    stats: { category: 'Combat' },
    translations: {
      en: {
        name: 'Sharpshooter',
        summary: 'Improves ranged precision at long range and through cover.',
        body: { sections: [{ title: 'Highlights', content: 'Optional -5 to hit for +10 damage with ranged attacks.' }] }
      },
      ru: {
        name: 'Меткий стрелок',
        summary: 'Улучшает дальние атаки и стрельбу сквозь укрытия.',
        body: { sections: [{ title: 'Ключевое', content: 'Опционально -5 к атаке за +10 к урону дальнобойным оружием.' }] }
      }
    }
  },
  {
    slug: 'war-caster',
    entityType: 'feat',
    stats: { category: 'Magic' },
    translations: {
      en: {
        name: 'War Caster',
        summary: 'Enhances concentration and casting in melee.',
        body: { sections: [{ title: 'Highlights', content: 'Advantage on concentration checks and somatic casting with occupied hands.' }] }
      },
      ru: {
        name: 'Боевой заклинатель',
        summary: 'Усиливает концентрацию и применение магии в ближнем бою.',
        body: { sections: [{ title: 'Ключевое', content: 'Преимущество на проверки концентрации и удобство соматических компонентов.' }] }
      }
    }
  },
  {
    slug: 'goblin',
    entityType: 'monster',
    stats: { challengeRating: '1/4', size: 'Small', creatureType: 'Humanoid', armorClass: 15, hitPoints: 7 },
    translations: {
      en: {
        name: 'Goblin',
        summary: 'A nimble, cunning humanoid often found in groups.',
        body: { sections: [{ title: 'Tactics', content: 'Uses Nimble Escape to disengage or hide every turn.' }] }
      },
      ru: {
        name: 'Гоблин',
        summary: 'Ловкий и хитрый гуманоид, часто действующий группой.',
        body: { sections: [{ title: 'Тактика', content: 'Использует Проворный побег, чтобы скрываться или отходить каждый ход.' }] }
      }
    }
  },
  {
    slug: 'young-red-dragon',
    entityType: 'monster',
    stats: { challengeRating: '10', size: 'Large', creatureType: 'Dragon', armorClass: 18, hitPoints: 178 },
    translations: {
      en: {
        name: 'Young Red Dragon',
        summary: 'A proud and destructive dragon with fiery breath.',
        body: { sections: [{ title: 'Threat', content: 'Fire Breath can devastate tightly packed parties.' }] }
      },
      ru: {
        name: 'Молодой красный дракон',
        summary: 'Гордый и разрушительный дракон с огненным дыханием.',
        body: { sections: [{ title: 'Опасность', content: 'Огненное дыхание крайне опасно для сгруппированных персонажей.' }] }
      }
    }
  },
  {
    slug: 'owlbear',
    entityType: 'monster',
    stats: { challengeRating: '3', size: 'Large', creatureType: 'Monstrosity', armorClass: 13, hitPoints: 59 },
    translations: {
      en: {
        name: 'Owlbear',
        summary: 'A savage hybrid predator with brute force.',
        body: { sections: [{ title: 'Behavior', content: 'Territorial and aggressive when threatened.' }] }
      },
      ru: {
        name: 'Сово-медведь',
        summary: 'Свирепый гибридный хищник, полагающийся на грубую силу.',
        body: { sections: [{ title: 'Поведение', content: 'Территориален и агрессивен при угрозе.' }] }
      }
    }
  },
  {
    slug: 'potion-of-healing',
    entityType: 'item',
    stats: { rarity: 'Common', category: 'Potion', requiresAttunement: false },
    translations: {
      en: {
        name: 'Potion of Healing',
        summary: 'A red liquid that restores hit points when consumed.',
        body: { sections: [{ title: 'Effect', content: 'Regain 2d4 + 2 hit points when drinking the potion.' }] }
      },
      ru: {
        name: 'Зелье лечения',
        summary: 'Красная жидкость, восстанавливающая хиты при употреблении.',
        body: { sections: [{ title: 'Эффект', content: 'Восстанавливает 2d4 + 2 хита при выпивании.' }] }
      }
    }
  },
  {
    slug: 'bag-of-holding',
    entityType: 'item',
    stats: { rarity: 'Uncommon', category: 'Wondrous item', requiresAttunement: false },
    translations: {
      en: {
        name: 'Bag of Holding',
        summary: 'An extradimensional bag with much larger interior capacity.',
        body: { sections: [{ title: 'Effect', content: 'Holds up to 500 pounds, not exceeding 64 cubic feet.' }] }
      },
      ru: {
        name: 'Сумка хранения',
        summary: 'Экстрапространственная сумка с сильно увеличенной вместимостью.',
        body: { sections: [{ title: 'Эффект', content: 'Вмещает до 500 фунтов предметов, максимум 64 куб. фута.' }] }
      }
    }
  },
  {
    slug: 'cloak-of-protection',
    entityType: 'item',
    stats: { rarity: 'Uncommon', category: 'Wondrous item', requiresAttunement: true },
    translations: {
      en: {
        name: 'Cloak of Protection',
        summary: 'A magical cloak that protects its wearer.',
        body: { sections: [{ title: 'Effect', content: 'Grants +1 bonus to AC and saving throws (attunement required).' }] }
      },
      ru: {
        name: 'Плащ защиты',
        summary: 'Магический плащ, защищающий носителя.',
        body: { sections: [{ title: 'Эффект', content: 'Дает +1 к КБ и спасброскам (требует настройку).' }] }
      }
    }
  }
];

const SRD_SEED_RELATIONS = [
  { fromSlug: 'wizard', toSlug: 'fireball', relationType: 'class_spell' },
  { fromSlug: 'wizard', toSlug: 'mage-hand', relationType: 'class_spell' },
  { fromSlug: 'barbarian', toSlug: 'great-weapon-master', relationType: 'class_feat' },
  { fromSlug: 'rogue', toSlug: 'sharpshooter', relationType: 'class_feat' },
  { fromSlug: 'elf', toSlug: 'wizard', relationType: 'recommended_for' },
  { fromSlug: 'dwarf', toSlug: 'barbarian', relationType: 'recommended_for' }
];

module.exports = {
  SRD_SEED_ENTITIES,
  SRD_SEED_RELATIONS
};
