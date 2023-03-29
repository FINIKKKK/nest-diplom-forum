import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QuestionDto } from './dto/question.dto';
import { ParamsQuestionDto } from './dto/params-question.dto';
import { QuestionEntity } from './question.entity';
import { AnswerEntity } from 'src/answers/answer.entity';
import { CommentEntity } from 'src/comments/comment.entity';
import { UserEntity } from 'src/users/user.entity';
import { TagEntity } from 'src/tags/tag.entity';

@Injectable()
export class QuestionsService {
  constructor(
    @InjectRepository(QuestionEntity)
    private questionsRepository: Repository<QuestionEntity>,
    @InjectRepository(AnswerEntity)
    private answersRepository: Repository<AnswerEntity>,
    @InjectRepository(CommentEntity)
    private commentsRepository: Repository<CommentEntity>,
    @InjectRepository(UserEntity)
    private usersRepository: Repository<UserEntity>,
    @InjectRepository(TagEntity)
    private tagsRepository: Repository<TagEntity>,
  ) {}

  async createQuestion(dto: QuestionDto, userId: number) {
    const question = await this.questionsRepository.save({
      ...dto,
      user: { id: userId },
    });
    return question;
  }

  async getAll(dto: ParamsQuestionDto) {
    const qb = await this.questionsRepository.createQueryBuilder('questions');

    qb.leftJoinAndSelect('questions.user', 'user');

    const limit = dto.limit || 2;
    const page = dto.page || 2;

    if (dto.limit) {
      qb.take(dto.limit);
    }
    if (dto.page) {
      qb.skip((page - 1) * limit);
    }

    if (dto.orderBy === 'popular') {
      qb.orderBy('questions.views', 'DESC');
    } else {
      qb.orderBy('questions.createdAt', 'DESC');
    }

    if (dto.tagBy) {
      const tag = dto.tagBy;
      qb.innerJoin('questions.tags', 'tag').where('tag.name = :tag', { tag });
    }

    if (dto.userId && !dto.favorites) {
      qb.where('user.id = :user', {
        user: dto.userId,
      });
    }

    if (dto.favorites && dto.userId) {
      const user = await this.usersRepository.findOne({
        where: { id: dto.userId },
      });
      if (!!user.favorites.length) {
        qb.where('questions.id IN (:...ids)', { ids: user.favorites });
      } else {
        qb.where('1=0');
      }
    }

    if (dto.search) {
      qb.andWhere('LOWER(questions.title) LIKE LOWER(:title)', {
        title: `%${dto.search}%`,
      });
    }

    if (dto.isAnswer === 'true') {
      qb.andWhere('questions.isAnswer IS TRUE');
    } else if (dto.isAnswer === 'false') {
      qb.andWhere('questions.isAnswer IS FALSE');
    }

    const [questions, total] = await qb
      .leftJoinAndSelect('questions.tags', 'tags')
      .getManyAndCount();

    const items = questions.map((obj) => {
      delete obj.body;
      return {
        ...obj,
        tags: obj.tags.map((item) => ({
          id: item.id,
          name: item.name,
        })),
        user: {
          id: obj.user.id,
        },
      };
    });
    return { total, items };
  }

  async getQuestionById(id: number) {
    await this.questionsRepository
      .createQueryBuilder('questions')
      .whereInIds(id)
      .update()
      .set({
        views: () => 'views + 1',
      })
      .execute();

    const question = await this.questionsRepository
      .createQueryBuilder('q')
      .whereInIds(id)
      .leftJoinAndSelect('q.user', 'user')
      .leftJoinAndSelect('q.tags', 'tags')
      .getOne();

    return {
      ...question,
      user: {
        id: question.user.id,
        login: question.user.login,
        name: question.user.name,
        avatar: question.user.avatar,
      },
      tags: question.tags.map((obj) => ({
        id: obj.id,
        name: obj.name,
      })),
    };
  }

  async updateQuestion(id: number, dto: QuestionDto) {
    const question = await this.questionsRepository.findOne({ where: { id } });

    if (dto.tags) {
      const tagIds = dto.tags.map((obj) => obj.id);
      const tags = await this.tagsRepository.findByIds(tagIds);
      question.tags = tags;
      delete dto.tags;
    }
    question.updated = new Date();
    await this.questionsRepository.save(question);
    await this.questionsRepository.update(id, dto);
    return question;
  }

  async removeQuestion(id: number) {
    const answers = await this.answersRepository.find({
      where: { question: { id } },
    });

    for (const answer of answers) {
      await this.commentsRepository.delete({ answer: { id: answer.id } });
    }

    await this.answersRepository.delete({ question: { id } });

    await this.questionsRepository.delete(id);
  }
}
