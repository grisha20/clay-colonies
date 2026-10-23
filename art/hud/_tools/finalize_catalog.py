"""Human-readable HUD locations for the final inventory."""
import json
import sys
sys.dont_write_bytecode=True
from build_hud import CATALOG,load_catalog
c=load_catalog()
where={
 'res':'game_hud.gd · верхняя панель ресурсов',
 'tool':'Счётчики инструментов / правая панель работ',
 'brand':'Вывеска Clayfolk слева сверху', 'mood':'Настроение у вывески слева сверху',
 'btn':'Квадратные кнопки HUD, глиф накладывается отдельно',
 'ui':'Общие панели, кнопки, статусы и полосы HUD',
 'build':'Нижняя панель построек — изображение над подписью и ценой',
 'group':'Вкладки групп нижней панели построек',
 'job':'Правая панель «Работы»', 'act':'Карточка выбранного жителя — текущее занятие',
 'task':'Левая панель «Задачи»', 'alert':'Уведомления и тревоги',
 'time':'Верхняя панель — время суток', 'weather':'Верхняя панель — погода',
 'minimap':'Правая нижняя миникарта', 'mother':'Облачко речи Праматери у миникарты',
 'menu':'Стартовое меню', 'logo':'Стартовое меню — логотип', 'cursor':'Указатель мыши',
}
resident={'glyph_follow','glyph_deselect','glyph_next_resident','glyph_gather','glyph_hand','glyph_forbid'}
for name,spec in c.items():
    if name.startswith('glyph_'):
        base=name.removesuffix('_light')
        location='Карточка выбранного жителя — кнопки действий' if base in resident else ('Панель работ — кнопки ±' if base in {'glyph_plus','glyph_minus'} else 'Правая верхняя панель — управление временем / настройками / тревогой')
        spec['where']=location+(' · светлый вариант для тёмной / красной подложки' if name.endswith('_light') else '')
    elif name.startswith('card_'):
        spec['where']='Левая нижняя карточка выбранного жителя' if name.startswith('card_resident') else 'Нижняя панель — рамка карточки постройки'
    else:
        spec['where']=where.get(spec['group'],spec['where'])
CATALOG.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
